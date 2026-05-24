# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app

# Install production deps first so this layer caches across code changes.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# The server binds :::3000 (dual-stack); the platform routes here.
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
