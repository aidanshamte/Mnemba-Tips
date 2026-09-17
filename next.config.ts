import type { NextConfig } from "next";

const azure = process.env.MNEMBA_TARGET === "azure";
const nextConfig: NextConfig = {
  ...(azure ? { output: "standalone" as const, typescript: { tsconfigPath: "tsconfig.azure.json" }, distDir: ".next-azure", serverExternalPackages: ["pg"], webpack(config: any, { webpack }: any) { config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, require.resolve("./lib/azure/bindings.mjs"))); return config; } } : {}),
  async redirects() { return azure ? [{ source: '/:path*', has: [{ type: 'host' as const, value: 'www.aidanshamte.me' }], destination: 'https://aidanshamte.me/:path*', permanent: true }] : []; },
  async headers(){return [{source:"/:path*",headers:[{key:"Content-Security-Policy",value:"img-src 'self' data: https://ichef.bbci.co.uk https://i.guim.co.uk https://media.guim.co.uk https://editorial.uefa.com https://img.uefa.com https://upload.wikimedia.org https://thumb.wikimedia.org https://www.thesportsdb.com https://r2.thesportsdb.com https://i.ytimg.com; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'self'"}]}];},
};

export default nextConfig;
