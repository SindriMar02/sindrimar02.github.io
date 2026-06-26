# Vendored JavaScript — provenance & integrity lock

These libraries are committed to the repo (no CDN, no build step, no runtime third-party
origin). Record the exact version, canonical source, and SHA-256 so any drift or tampering
is detectable. Re-verify any time with:

    shasum -a 256 gsap.min.js ScrollTrigger.min.js lenis.min.js

| file | version | canonical source | sha256 |
|------|---------|------------------|--------|
| gsap.min.js | GSAP 3.12.5 | https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js | `53c3a2be6f0df881861adce7bcc3da341a64f5fefe244634f9a37197d0f58fb7` |
| ScrollTrigger.min.js | ScrollTrigger 3.12.5 | https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js | `1689c1a15d71ec9e9d6e4f19b81b88b245b184d55dc0d2f73a3c204d5d897957` |
| lenis.min.js | Lenis 1.1.20 | https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js | `6de115d6779bf952e5ed14b5cb17054009326106f80e747b516527a68027ed62` |

All three hashes match the upstream published builds exactly (verified) → the vendored copies
are unmodified and known-good. GSAP/ScrollTrigger 3.12.5 and Lenis 1.1.20 have no known security
advisories as of 2026-06.

`deploy-pages.sh` re-verifies these SHA-256 values before every publish (vendor tripwire); a
mismatch aborts the deploy. When you intentionally upgrade a library, update BOTH this file and
the hash list in `deploy-pages.sh`.
