# 1. Yengil va xavfsiz Node.js LTS asosidagi muhit
FROM node:20-alpine AS base

# Ishchi papkani belgilash
WORKDIR /app

# Muhit o'zgaruvchilari
ENV NODE_ENV=production

# 2. Bog'liqliklarni o'rnatish
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 3. Loyiha manba kodlarini nusxalash
COPY . .

# Xavfsizlik: root bo'lmagan foydalanuvchiga o'tish
USER node

# Portni ochish
EXPOSE 3000

# Sog'lomlik tekshiruvi (Healthcheck)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# 4. Serverni ishga tushirish
CMD ["node", "src/index.js"]
