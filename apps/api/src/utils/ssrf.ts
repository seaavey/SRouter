import { promises as dns } from "node:dns";
import net from "node:net";

function IsPrivateIpv4(Address: string): boolean {
    const Parts = Address.split(".").map(Number);
    if (Parts.length !== 4 || Parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return true;
    }
    const [A, B] = Parts as [number, number, number, number];
    if (A === 0 || A === 10 || A === 127) return true; // this-network / RFC1918 / loopback
    if (A === 169 && B === 254) return true; // link-local + cloud metadata
    if (A === 172 && B >= 16 && B <= 31) return true; // RFC1918
    if (A === 192 && B === 168) return true; // RFC1918
    if (A === 192 && B === 0) return true; // IETF protocol assignments
    if (A === 100 && B >= 64 && B <= 127) return true; // CGNAT
    if (A >= 224) return true; // multicast + reserved
    return false;
}

function IsPrivateIpv6(Address: string): boolean {
    const Lower = Address.toLowerCase().replace(/^::ffff:/, "");
    if (Lower.includes(".")) return IsPrivateIpv4(Lower.split(".").slice(-4).join("."));
    if (Lower === "::" || Lower === "::1") return true; // unspecified / loopback
    const Head = Lower.split(":")[0] ?? "";
    const Prefix = parseInt(Head.padStart(4, "0").slice(0, 2), 16);
    if ((Prefix & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
    if (Head.startsWith("fe8") || Head.startsWith("fe9") || Head.startsWith("fea") || Head.startsWith("feb")) return true; // link-local
    if (Head.startsWith("ff")) return true; // multicast
    return false;
}

export function IsPrivateIpAddress(Address: string): boolean {
    const Family = net.isIP(Address);
    if (Family === 4) return IsPrivateIpv4(Address);
    if (Family === 6) return IsPrivateIpv6(Address);
    return true; // not a parseable IP → treat as unsafe
}

/**
 * Resolves a hostname and rejects it when ANY resolved address is private,
 * loopback, link-local, multicast, or a cloud metadata endpoint. DNS
 * resolution happens once here and the caller can trust the verdict for the
 * immediate request; redirect following must stay disabled to keep it sound.
 */
export async function AssertPublicUrl(RawUrl: string): Promise<void> {
    const Url = new URL(RawUrl);
    if (!["http:", "https:"].includes(Url.protocol)) {
        throw new Error("URL endpoint must use HTTP or HTTPS.");
    }

    const Hostname = Url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (Hostname === "metadata.google.internal" || Hostname === "instance-data") {
        throw new Error("Internal/metadata endpoints are blocked.");
    }

    if (net.isIP(Hostname)) {
        if (IsPrivateIpAddress(Hostname)) {
            throw new Error("Internal/private IP targets are blocked.");
        }
        return;
    }

    let Addresses: { address: string }[];
    try {
        Addresses = await dns.lookup(Hostname, { all: true, verbatim: true });
    } catch {
        throw new Error("Hostname could not be resolved.");
    }
    if (Addresses.length === 0) throw new Error("Hostname could not be resolved.");
    if (Addresses.some((Entry) => IsPrivateIpAddress(Entry.address))) {
        throw new Error("Hostname resolves to a private/internal address.");
    }
}
