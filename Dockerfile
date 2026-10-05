# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including dev for building)
RUN npm install

# Copy application source code
COPY . .

# Build the client application (produces /app/dist)
RUN npm run build

# Expose default port
EXPOSE 3001

# Production environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Start the full-stack server (serves frontend static assets + REST API + WebSocket sync)
CMD ["npm", "start"]
