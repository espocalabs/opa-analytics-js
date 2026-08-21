#!/usr/bin/env python3
"""Upload a single object to Cloudflare R2 via a hand-rolled SigV4 PUT.

Why not the AWS CLI: recent aws-cli v2 attaches CRC32 request checksums with
aws-chunked streaming trailers by default, which R2 rejects with
`SignatureDoesNotMatch` even when AWS_REQUEST_CHECKSUM_CALCULATION=when_required.
This signer sends a plain SHA256 payload hash and nothing else, so there is no
streaming/trailer machinery to disagree about. Pure stdlib, no dependencies —
python3 is preinstalled on ubuntu runners.

Env contract:
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  R2 S3 API credentials
  R2_ENDPOINT     e.g. https://<account>.r2.cloudflarestorage.com
  R2_BUCKET       bucket name
  R2_KEY          object key            (default: sdk.js)
  R2_BODY         path to the file      (default: packages/analytics/dist/sdk.js)
  R2_CONTENT_TYPE (default: application/javascript; charset=utf-8)
  R2_CACHE_CONTROL(default: public, max-age=3600)
"""

import datetime
import hashlib
import hmac
import os
import re
import sys
import urllib.error
import urllib.request

REGION = "auto"
SERVICE = "s3"


def need(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"[upload-r2] missing env {name}")
    return value


def sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def main() -> None:
    access_key = need("AWS_ACCESS_KEY_ID")
    secret_key = need("AWS_SECRET_ACCESS_KEY")
    endpoint = need("R2_ENDPOINT")
    bucket = need("R2_BUCKET")
    key = os.environ.get("R2_KEY", "sdk.js")
    body_path = os.environ.get("R2_BODY", "packages/analytics/dist/sdk.js")
    content_type = os.environ.get(
        "R2_CONTENT_TYPE", "application/javascript; charset=utf-8"
    )
    cache_control = os.environ.get("R2_CACHE_CONTROL", "public, max-age=3600")

    with open(body_path, "rb") as handle:
        body = handle.read()

    host = re.sub(r"^https?://", "", endpoint).rstrip("/")
    canonical_uri = f"/{bucket}/{key}"
    url = f"https://{host}{canonical_uri}"

    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()

    canonical_headers = (
        f"cache-control:{cache_control}\n"
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = (
        "cache-control;content-type;host;x-amz-content-sha256;x-amz-date"
    )
    canonical_request = (
        "PUT\n"
        f"{canonical_uri}\n"
        "\n"
        f"{canonical_headers}\n"
        f"{signed_headers}\n"
        f"{payload_hash}"
    )
    scope = f"{datestamp}/{REGION}/{SERVICE}/aws4_request"
    string_to_sign = (
        "AWS4-HMAC-SHA256\n"
        f"{amz_date}\n"
        f"{scope}\n"
        + hashlib.sha256(canonical_request.encode()).hexdigest()
    )

    k_date = sign(("AWS4" + secret_key).encode(), datestamp)
    k_region = sign(k_date, REGION)
    k_service = sign(k_region, SERVICE)
    k_signing = sign(k_service, "aws4_request")
    signature = hmac.new(
        k_signing, string_to_sign.encode(), hashlib.sha256
    ).hexdigest()

    authorization = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    request = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "Authorization": authorization,
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
            "content-type": content_type,
            "cache-control": cache_control,
            "content-length": str(len(body)),
        },
    )
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:800]
        sys.exit(f"[upload-r2] HTTP {error.code}\n{detail}")
    except Exception as error:  # noqa: BLE001 - surface anything else clearly
        sys.exit(f"[upload-r2] {type(error).__name__}: {error}")

    print(
        f"[upload-r2] PUT {canonical_uri} ok "
        f"({len(body)} bytes, status {response.status}, "
        f"etag {response.headers.get('ETag')})"
    )


if __name__ == "__main__":
    main()
