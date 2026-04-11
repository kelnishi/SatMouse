#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

echo "Generating self-signed dev certificate..."

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -nodes \
  -subj "/CN=SatMouse Dev" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Print certificate hash for WebTransport serverCertificateHashes
echo ""
echo "Certificate SHA-256 hash (for WebTransport clients):"
openssl x509 -in "$CERT_DIR/cert.pem" -outform der | openssl dgst -sha256 -binary | base64
echo ""
echo "Certificate saved to $CERT_DIR/"
