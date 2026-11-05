#!/bin/bash
# One-time: create a stable, self-signed code-signing identity for local Flo builds.
#
# Why: ad-hoc builds get a new identity every rebuild, so macOS forgets Microphone /
# Accessibility / Input Monitoring grants and re-asks for Keychain access each time.
# Signing every build with the same certificate keeps grants across updates.
#
# Everything lives in ~/.flo-signing (its own keychain file). Nothing is added to your login
# keychain and no system trust settings are changed. Remove with: rm -rf ~/.flo-signing
set -euo pipefail
DIR="$HOME/.flo-signing"
KC="$DIR/flo-signing.keychain-db"
NAME="Flo Local Signing"

if [ -f "$KC" ]; then
  echo "Signing identity already set up in $KC"
  exit 0
fi
mkdir -p "$DIR"
chmod 700 "$DIR"
PASS="$(openssl rand -hex 24)"
echo "$PASS" > "$DIR/keychain-password"
chmod 600 "$DIR/keychain-password"

cat > "$DIR/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -config "$DIR/cert.cnf" 2>/dev/null
# macOS `security` only reads legacy PKCS#12 (3DES/SHA1). OpenSSL 3+ needs -legacy;
# Apple's LibreSSL (/usr/bin/openssl) writes legacy by default.
openssl pkcs12 -export -legacy -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
  -name "$NAME" -out "$DIR/identity.p12" -passout pass:flo 2>/dev/null \
  || /usr/bin/openssl pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
       -name "$NAME" -out "$DIR/identity.p12" -passout pass:flo

security create-keychain -p "$PASS" "$KC"
security set-keychain-settings "$KC"            # no auto-lock timeout
security unlock-keychain -p "$PASS" "$KC"
security import "$DIR/identity.p12" -k "$KC" -P flo -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KC" >/dev/null
rm -f "$DIR/key.pem" "$DIR/identity.p12"
echo "Created signing identity \"${NAME}\" in ${KC}"
