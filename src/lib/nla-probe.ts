// Server-only RDP NLA (CredSSP) banner-grab library.
// Imported exclusively by API routes — never by client code.
//
// Technique (mirrors nmap's rdp-ntlm-info script, Tom Sellers):
//   1. X.224 Connection Request advertising SSL | HYBRID | HYBRID_EX
//   2. X.224 Connection Confirm from the server
//   3. Upgrade the socket to TLS
//   4. Send a static TS_REQUEST (MS-CSSP) carrying a null-credential
//      NTLMSSP NEGOTIATE message
//   5. The server replies with an NTLMSSP CHALLENGE that discloses the
//      Product Version (build), NetBIOS computer name and domain names —
//      no authentication required.
//
// Every failure path resolves to null; callers must treat detection as
// best-effort metadata on top of the real TCP probe.

import net from "node:net";
import tls from "node:tls";

export interface NlaInfo {
  osVersion: string | null; // raw product version, e.g. "10.0.20348"
  osName: string | null; // friendly name, e.g. "Windows Server 2022"
  computerName: string | null; // NetBIOS computer name (from AV_PAIR id 2)
  domainName: string | null; // NetBIOS domain name (from AV_PAIR id 1)
}

const PROTOCOL_SSL = 0x00000001;
const PROTOCOL_HYBRID = 0x00000002;
const PROTOCOL_HYBRID_EX = 0x00000008;
const REQUESTED_PROTOCOLS = PROTOCOL_SSL | PROTOCOL_HYBRID | PROTOCOL_HYBRID_EX;

// TS_REQUEST DER blob (SEQUENCE { version, [0] negoTokens }) carrying a
// 40-byte NTLMSSP NEGOTIATE message that mimics a Windows 10 (1809) client.
// Byte-for-byte identical to nmap's rdp-ntlm-info.nse negotiate blob.
const NTLM_NEGOTIATE_BLOB = Buffer.from(
  "3037" +
    "a003020160" +
    "a130" +
    "302e" +
    "302c" +
    "a02a" +
    "0428" +
    "4e544c4d53535000" + // signature "NTLMSSP\0"
    "01000000" + // message type 1 (NEGOTIATE)
    "b78208e2" + // negotiate flags
    "0000000000000000" + // domain name len/max/offset
    "0000000000000000" + // workstation len/max/offset
    "0a0063450000000f", // version 10.0 build 17763, revision 15
  "hex"
);

const NTLMSSP_SIGNATURE = Buffer.from("NTLMSSP\0", "ascii");

/** Friendly product name for known NT kernel builds. */
function mapWindowsName(major: number, minor: number, build: number): string {
  const table: Record<number, string> = {
    3790: "Windows Server 2003",
    6001: "Windows Server 2008 / Vista SP1",
    6002: "Windows Server 2008 / Vista SP2",
    7600: "Windows 7 / Server 2008 R2",
    7601: "Windows 7 / Server 2008 R2 SP1",
    9200: "Windows 8 / Server 2012",
    9600: "Windows 8.1 / Server 2012 R2",
    10240: "Windows 10 (1507)",
    10586: "Windows 10 (1511)",
    14393: "Windows Server 2016 / Windows 10 (1607)",
    15063: "Windows 10 (1703)",
    16299: "Windows 10 (1709)",
    17134: "Windows 10 (1803)",
    17763: "Windows Server 2019 / Windows 10 (1809)",
    18362: "Windows 10 (1903)",
    18363: "Windows 10 (1909)",
    19041: "Windows 10 (2004)",
    19042: "Windows 10 (20H2)",
    19043: "Windows 10 (21H1)",
    19044: "Windows 10 (21H2)",
    19045: "Windows 10 (22H2)",
    20348: "Windows Server 2022",
    22000: "Windows 11 (21H2)",
    22621: "Windows 11 (22H2)",
    22631: "Windows 11 (23H2)",
    25398: "Windows Server (23H2 Azure Edition)",
    26100: "Windows Server 2025 / Windows 11 (24H2)",
  };
  return table[build] ?? `Windows (NT ${major}.${minor}, build ${build})`;
}

interface ParsedChallenge {
  osVersion: string | null;
  osName: string | null;
  computerName: string | null;
  domainName: string | null;
  complete: boolean; // true when all referenced payload fields are in-bounds
}

/**
 * Parse an NTLMSSP CHALLENGE_MESSAGE (MS-NLMP 2.2.1.2).
 * Layout: signature(8) type(4) targetNameFields(8) flags(4)
 *         serverChallenge(8) reserved(8) targetInfoFields(8) version(8?) payload...
 */
function parseChallengeMessage(buf: Buffer, start: number): ParsedChallenge | null {
  const minHeader = start + 48; // through targetInfoFields
  if (buf.length < minHeader) return null;
  const messageType = buf.readUInt32LE(start + 8);
  if (messageType !== 2) return null; // not a CHALLENGE

  const tnLen = buf.readUInt16LE(start + 12);
  const tnOff = buf.readUInt32LE(start + 16);
  const tiLen = buf.readUInt16LE(start + 40);
  const tiOff = buf.readUInt32LE(start + 44);

  let complete = true;

  // Version struct lives at offset 48 — when present, every payload offset
  // shifts to >= 56. Schannel servers often emit the struct without setting
  // NTLMSSP_NEGOTIATE_VERSION, so sniff it via the payload offsets instead.
  let osVersion: string | null = null;
  let osName: string | null = null;
  const payloadStart = Math.min(
    tnLen > 0 ? tnOff : Number.POSITIVE_INFINITY,
    tiLen > 0 ? tiOff : Number.POSITIVE_INFINITY
  );
  // NOTE: tnOff/tiOff are offsets relative to the NTLM message start (== `start`
  // in our buffer), so a version struct is present when every payload offset
  // sits at/after 56 within the message.
  if (payloadStart >= 56 && buf.length >= start + 56) {
    const major = buf.readUInt8(start + 48);
    const minor = buf.readUInt8(start + 49);
    const build = buf.readUInt16LE(start + 50);
    if (major >= 3 && major <= 10 && minor <= 3 && build >= 1000) {
      osVersion = `${major}.${minor}.${build}`;
      osName = mapWindowsName(major, minor, build);
    }
  }

  const utf16 = (off: number, len: number): string | null => {
    if (len <= 0) return null;
    if (buf.length < start + off + len) {
      complete = false;
      return null;
    }
    return buf.slice(start + off, start + off + len).toString("utf16le");
  };

  const targetName = utf16(tnOff, tnLen);

  let computerName: string | null = null;
  let domainName: string | null = null;
  let dnsComputerName: string | null = null;
  if (tiLen > 0) {
    if (buf.length < start + tiOff + tiLen) {
      complete = false;
    } else {
      let p = start + tiOff;
      const end = start + tiOff + tiLen;
      while (p + 4 <= end) {
        const avId = buf.readUInt16LE(p);
        const avLen = buf.readUInt16LE(p + 2);
        p += 4;
        if (avId === 0) break; // MsvAvEOL
        if (p + avLen > end) break;
        const value = buf.slice(p, p + avLen).toString("utf16le");
        if (avId === 1 && !domainName) domainName = value; // MsvAvNbDomainName
        else if (avId === 2 && !computerName) computerName = value; // MsvAvNbComputerName
        else if (avId === 4 && !dnsComputerName) dnsComputerName = value; // MsvAvDnsComputerName
        p += avLen;
      }
    }
  }

  // Fallback chain: NetBIOS computer name -> DNS computer name -> target name.
  computerName = computerName || dnsComputerName || targetName;

  return { osVersion, osName, computerName, domainName, complete };
}

interface NlaOptions {
  connectTimeoutMs?: number;
  tlsTimeoutMs?: number;
  challengeTimeoutMs?: number;
}

/**
 * Best-effort CredSSP banner grab. Resolves null whenever any step fails
 * (connection refused, no TLS, no CredSSP, non-Windows server, timeouts).
 */
export function nlaDetect(host: string, port: number, options: NlaOptions = {}): Promise<NlaInfo | null> {
  const connectTimeoutMs = options.connectTimeoutMs ?? 3000;
  const tlsTimeoutMs = options.tlsTimeoutMs ?? 2500;
  const challengeTimeoutMs = options.challengeTimeoutMs ?? 2500;

  return new Promise<NlaInfo | null>((resolve) => {
    if (!host || typeof port !== "number" || port < 1 || port > 65535) {
      resolve(null);
      return;
    }

    let settled = false;
    let raw: net.Socket | null = null;
    let secure: tls.TLSSocket | null = null;
    let connectTimer: NodeJS.Timeout | null = null;
    let tlsTimer: NodeJS.Timeout | null = null;
    let challengeTimer: NodeJS.Timeout | null = null;
    let x224Buffer = Buffer.alloc(0);

    const cleanup = () => {
      if (connectTimer) clearTimeout(connectTimer);
      if (tlsTimer) clearTimeout(tlsTimer);
      if (challengeTimer) clearTimeout(challengeTimer);
      try {
        secure?.destroy();
      } catch {
        /* ignore */
      }
      try {
        raw?.destroy();
      } catch {
        /* ignore */
      }
    };

    const finish = (info: NlaInfo | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(info);
    };

    const fail = () => finish(null);

    // --- step 1: TCP + X.224 Connection Request -----------------------------
    raw = new net.Socket();
    connectTimer = setTimeout(fail, connectTimeoutMs);

    raw.once("error", fail);
    raw.once("timeout", fail);

    raw.once("connect", () => {
      if (settled) return;
      raw!.write(buildConnectionRequest(REQUESTED_PROTOCOLS));
    });

    // Accumulate the X.224 Connection Confirm (single TPKT frame).
    raw.on("data", (chunk: Buffer) => {
      if (settled) return;
      x224Buffer = Buffer.concat([x224Buffer, chunk]);
      if (x224Buffer.length < 4) return;
      const tpktLen = x224Buffer.readUInt16BE(2);
      if (tpktLen < 11 || tpktLen > 512) {
        fail(); // implausible frame -> give up
        return;
      }
      if (x224Buffer.length < tpktLen) return;

      // Confirm TPDU: LI(1) code(1). 0xD0 = Connection Confirm.
      if (x224Buffer[5] !== 0xd0) {
        fail();
        return;
      }

      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;

      // --- step 2: TLS upgrade on the same socket ---------------------------
      let tlsDone = false;
      secure = tls.connect({
        socket: raw,
        rejectUnauthorized: false,
        minVersion: "TLSv1",
        // CredSSP over RDP does not complete on TLS 1.3 with Windows servers —
        // cap at TLS 1.2 exactly like mstsc/Schannel does.
        maxVersion: "TLSv1.2",
      });
      tlsTimer = setTimeout(() => {
        if (!tlsDone) fail();
      }, tlsTimeoutMs);

      secure.once("error", () => {
        if (!tlsDone) fail();
      });
      secure.once("secureConnect", () => {
        if (settled || tlsDone) return;
        tlsDone = true;
        if (tlsTimer) clearTimeout(tlsTimer);
        tlsTimer = null;

        // --- step 3: null-credential NTLM NEGOTIATE -------------------------
        let challenge = Buffer.alloc(0);
        const tryParse = (): NlaInfo | null => {
          const idx = challenge.indexOf(NTLMSSP_SIGNATURE);
          if (idx === -1) return null;
          const parsed = parseChallengeMessage(challenge, idx);
          if (!parsed || !parsed.complete) return null;
          return {
            osVersion: parsed.osVersion,
            osName: parsed.osName,
            computerName: parsed.computerName,
            domainName: parsed.domainName,
          };
        };

        challengeTimer = setTimeout(() => {
          finish(tryParse());
        }, challengeTimeoutMs);

        secure!.once("error", () => {
          finish(tryParse());
        });

        secure!.on("data", (d: Buffer) => {
          challenge = Buffer.concat([challenge, d]);
          const info = tryParse();
          if (info) finish(info);
        });

        secure!.write(NTLM_NEGOTIATE_BLOB);
      });
    });

    raw.connect(port, host);
  });
}

/** Build the X.224 Connection Request PDU (TPKT + CR TPDU + RDP_NEG_REQ). */
function buildConnectionRequest(requestedProtocols: number): Buffer {
  const cookie = Buffer.from("Cookie: mstshash=rdpconsole\r\n", "ascii");
  const negReq = Buffer.alloc(8);
  negReq.writeUInt8(0x01, 0); // TYPE_RDP_NEG_REQ
  negReq.writeUInt8(0x00, 1); // flags
  negReq.writeUInt16LE(0x0008, 2); // length
  negReq.writeUInt32LE(requestedProtocols, 4);

  const data = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]), // dst-ref(2) src-ref(2) class(1)
    cookie,
    negReq,
  ]);
  const li = data.length + 1; // LI counts the TPDU code byte too
  const itut = Buffer.concat([Buffer.from([li, 0xe0]), data]);

  const total = itut.length + 4;
  const tpkt = Buffer.alloc(4);
  tpkt.writeUInt8(0x03, 0);
  tpkt.writeUInt8(0x00, 1);
  tpkt.writeUInt16BE(total, 2);
  return Buffer.concat([tpkt, itut]);
}
