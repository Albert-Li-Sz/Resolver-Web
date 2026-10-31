# Third-party notices

ICPC Tools and the components ported from it retain the ICPC Software License,
Copyright (C) 2019 ICPC Foundation. The original license is included verbatim in
`public/assets/ICPC-LICENSE.txt` and `reference/icpctools/LICENSE`. It applies to
the ICPC Tools reference source, the renderer and scoring logic derived from it,
and the bundled ICPC fonts/images. The project distribution follows the target repository's Apache-2.0 license.
The original Resolver Web MIT notice is preserved in
`licenses/Resolver-original-MIT.txt`. Neither grant replaces the upstream ICPC
license or grants trademark rights.

The bundled `public/assets/font/Helvetica-Plain.ttf` is byte-identical to
`reference/icpctools/PresContest/src/font/Helvetica-Plain.ttf` in this checkout.
ICPC logos and names remain the property of their respective owners.

`public/assets/img/icpc-logo.png` is copied unchanged from ICPC Tools
`ContestUtil/src/images/icpc-logo.png` and is the default school logo.
The school names, aliases and logo paths in `public/js/school-logo-catalog.js`
come from the Hydro Contest Team School Logo Registry at
https://avatar.hydrooj.com/. School logos are loaded from that service and remain
the property of their respective institutions; they are not bundled here.

The previously bundled DM Sans font is Copyright 2014 The DM Sans
Project Authors. Its SIL Open Font License 1.1 is included in
`public/assets/font/DM-Sans-OFL.txt`. Upstream:
https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt

Express and its dependencies retain the licenses included in their npm packages.

The platform interface uses React and React DOM (MIT), Vite and TypeScript as
build tools (MIT and Apache-2.0 respectively), and hls.js (Apache-2.0). Their
license files are supplied by the corresponding npm packages. Live-v3
(https://github.com/icpc/live-v3, MIT), commit
`200c82f81ffdea91ffec9cc17b314ffc72436a0f`, supplies the original Live
overlay components in `frontend/vendor/icpc-live`. Its MIT notice is included
in that directory and `public/licenses/icpc-live.txt`. The vendor manifest
records source hashes and transport adapters. ICPC Tools v2.6.1331 supplies
the presentation geometry, digital-clock polygons and Helvetica glyph outlines;
its notice is also included in `public/licenses/icpc-tools.txt`. The JVM services
and official client wire protocol are not bundled.
Bundled frontend dependency notices, including Redux, styled-components,
Lodash, Luxon and html2canvas, are preserved in
`public/licenses/frontend-dependencies.txt`.

The optional platform Compose deployment uses MediaMTX
(https://github.com/bluenviron/mediamtx, MIT) and Alpine's FFmpeg package.
The FFmpeg build includes GPL-enabled codecs, including libx264; the media
worker distribution retains FFmpeg's GPL notices. Package source and build
recipes: https://gitlab.alpinelinux.org/alpine/aports/-/tree/master/community/ffmpeg
and https://ffmpeg.org/download.html. MediaMTX and FFmpeg are separate services
and their original licenses continue to apply.

## Noto Sans SC

Chinese presentation text embeds the unmodified Noto Sans SC variable font from
[Google Fonts](https://github.com/google/fonts/tree/main/ofl/notosanssc).
Copyright 2014–2021 Adobe. Licensed under SIL Open Font License 1.1;
see `public/licenses/noto-sans-sc.txt`. Source metadata and SHA-256 are recorded
in `public/assets/font/noto-sans-sc.json`.
