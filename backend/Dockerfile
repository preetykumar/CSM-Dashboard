# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Remove build tools after installation
RUN apk del python3 make g++

# Copy built files
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite
RUN mkdir -p /app/data

# Cloud Run uses PORT environment variable
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
