# BlendTinux

A free, absurdly simple 3D modeller that runs entirely in your browser: sculpt, paint, deform and export to GLB, OBJ, STL or PLY. Nothing is ever uploaded.

Live at https://tinux.dev/blendtinux/

## Run locally

Static, no build step. ES modules will not load from `file://`, so serve the folder with any static server:

```powershell
pnpm dlx serve . -l 8080
```

Then open http://localhost:8080/

## Third-party

three.js (MIT), vendored in `js/`. Its own license applies to those files.

## License

MIT, see [LICENSE](LICENSE).

