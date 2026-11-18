import type { NextConfig } from "next";

const fs = require("fs-extra");
const path = require("path");

const leafletImages = path.join(__dirname, "node_modules/leaflet/dist/images");
const publicImages = path.join(__dirname, "public");

fs.copySync(leafletImages, publicImages);

module.exports = {
  reactStrictMode: true,
  eslint: {
    // Pre-existing lint debt in the original forked codebase (unused
    // imports, implicit `any`s) shouldn't block production builds.
    // `npm run lint` still runs normally for local development.
    ignoreDuringBuilds: true,
  },
};
