# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage - serve with simple HTTP server
FROM node:18-alpine

WORKDIR /app

# Install serve package globally
RUN npm install -g serve

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Expose frontend port
EXPOSE 5623

# Serve the static files
CMD ["serve", "-s", "dist", "-l", "5623"]
