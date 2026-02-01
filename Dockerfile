# Build frontend stage
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm install

# Copy frontend source
COPY frontend/ .

# Build frontend (API_URL will be /api since same origin)
RUN npm run build

# Build backend stage
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy backend package files
COPY backend/package*.json ./

# Install all dependencies (including dev for build)
RUN npm install

# Copy backend source code
COPY backend/ .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Install production dependencies only
COPY backend/package*.json ./
RUN npm install --omit=dev

# Remove build tools after installation
RUN apk del python3 make g++

# Copy built backend files
COPY --from=backend-builder /app/dist ./dist

# Copy built frontend files to public directory
COPY --from=frontend-builder /frontend/dist ./public

# Create data directory for SQLite
RUN mkdir -p /app/data

# Cloud Run uses PORT environment variable
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
