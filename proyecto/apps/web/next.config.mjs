// Los paquetes del monorepo se publican como fuentes TypeScript: Next debe compilarlos.
/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@cafeteria/ui', '@cafeteria/contracts'],
};

export default config;
