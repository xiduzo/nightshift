# Your LAN: a `.local` name

Your computers find the Host by its LAN name, `<name>.local`, with mDNS.
Put this address first: at home your computers then sync on the LAN.

## 1. Find the LAN name

- **macOS** has one already. See System Settings → General → Sharing →
  Local hostname, for example `studio.local`.
- **Linux** gets one from Avahi:

  ```bash
  sudo apt install avahi-daemon
  hostname   # studio → studio.local
  ```

Check it from another computer: `ping studio.local`.

## 2. Make a certificate

No public authority signs a certificate for a `.local` name. Make your own.
Your other computers pin it when they pair.

```bash
mkdir -p ~/.nightshift-tls && cd ~/.nightshift-tls
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout key.pem -out cert.pem -subj "/CN=studio.local" \
  -addext "subjectAltName=DNS:studio.local"
chmod 600 key.pem
```

## 3. Serve https:// with it

Start Night Shift with the certificate. It serves `https://` on port 3443
(`PORT` + 443) for other computers, and keeps plain http on port 3000 for
this computer.

```bash
NIGHTSHIFT_TLS_CERT=~/.nightshift-tls/cert.pem \
NIGHTSHIFT_TLS_KEY=~/.nightshift-tls/key.pem \
nightshift serve --host-address https://studio.local:3443
```

In the desktop app, set the same two variables before you open it, and add
`https://studio.local:3443` under Devices → Be a Host.

Set `NIGHTSHIFT_TLS_PORT` for another port.

## 4. Pair

Follow [Pair a computer with the Host](README.md#pair-a-computer-with-the-host).
The other computer shows the fingerprint of the certificate with the code.
The Host shows its fingerprint on its Devices page. Allow the computer only
when the two are the same.

When you make a new certificate, pair your computers again: they trust only
the certificate they pinned.
