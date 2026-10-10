//! Address guards for upstream URLs derived from user input. Built-in providers
//! use fixed, trusted base URLs; only user-supplied targets pass through here.

use std::net::{IpAddr, Ipv6Addr, ToSocketAddrs};

/// Returns `true` for addresses a user-supplied upstream URL must never reach:
/// loopback, private, link-local, unique-local, unspecified, and similar.
pub fn is_blocked_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_loopback()
                || address.is_private()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_unspecified()
                || address.octets()[0] == 0
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || is_unique_local(address)
                || is_unicast_link_local(address)
        }
    }
}

/// Resolves `host` and reports whether any resolved address is blocked. A host
/// that is already a literal IP is checked without DNS.
pub fn is_blocked_host(host: &str, port: u16) -> bool {
    if let Ok(address) = host.parse::<IpAddr>() {
        return is_blocked_address(address);
    }

    match (host, port).to_socket_addrs() {
        Ok(addresses) => addresses
            .map(|address| address.ip())
            .any(is_blocked_address),
        Err(_) => false,
    }
}

fn is_unique_local(address: Ipv6Addr) -> bool {
    (address.segments()[0] & 0xfe00) == 0xfc00
}

fn is_unicast_link_local(address: Ipv6Addr) -> bool {
    (address.segments()[0] & 0xffc0) == 0xfe80
}

#[cfg(test)]
mod tests {
    use std::net::IpAddr;

    use super::{is_blocked_address, is_blocked_host};

    fn address(value: &str) -> IpAddr {
        value.parse().expect("test address")
    }

    #[test]
    fn loopback_private_and_link_local_addresses_are_blocked() {
        for value in [
            "127.0.0.1",
            "10.0.0.5",
            "172.16.4.4",
            "192.168.1.10",
            "169.254.169.254",
            "0.0.0.0",
            "::1",
            "fd00::1",
            "fe80::1",
        ] {
            assert!(
                is_blocked_address(address(value)),
                "{value} must be blocked"
            );
        }
    }

    #[test]
    fn public_addresses_are_allowed() {
        for value in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(
                !is_blocked_address(address(value)),
                "{value} must be allowed"
            );
        }
    }

    #[test]
    fn literal_ip_hosts_are_checked_without_dns() {
        assert!(is_blocked_host("127.0.0.1", 443));
        assert!(is_blocked_host("169.254.169.254", 80));
        assert!(!is_blocked_host("1.1.1.1", 443));
    }
}
