# Presentation font assets

Generated from the unchanged `font/Helvetica-Plain.ttf` in the official ICPC Tools
v2.6.1331 presentations distribution. Font SHA-256:
`b917e29bbb97b5c18e9500a18a87ee989d5d61eb5b39a417043a8d6f16ecf8ac`.

The browser and Java synthesize bold text differently. These generators retain
Java's glyph outlines, advances and integer layout metrics at 1080p, 1440p and
2160p. Other sizes use the same outlines and browser fallback metrics. CJK names
use the existing system font fallback.

To regenerate, extract `presentations-2.6.1331.zip` from the official ICPC Tools
release into a temporary directory. With Java 21 or newer:

```sh
javac -cp '/path/to/presentations/lib/*' scripts/presentation-assets/Glyphs.java scripts/presentation-assets/Metrics.java
java -cp '/path/to/presentations/lib/*:scripts/presentation-assets' Glyphs > public/js/render/presentation-glyphs.js
java -cp '/path/to/presentations/lib/*:scripts/presentation-assets' Metrics > public/js/render/presentation-metrics.js
```

Java is only needed to regenerate these checked-in assets. The deployed app is
pure Web/Node and has no Java runtime dependency. ICPC's license is preserved in
`public/licenses/icpc-tools.txt` and `public/assets/ICPC-LICENSE.txt`.
