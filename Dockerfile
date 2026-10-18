# Ship's Memory - Cloud Run image (Express API + built React app)
FROM node:22-slim
WORKDIR /app

# Install all dependencies (tsx and vite are needed to build and run)
COPY package*.json ./
RUN npm install

# Copy source and build the frontend into /app/dist
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Cloud Run sets PORT (default 8080); server.ts reads it
EXPOSE 8080
CMD ["npx", "tsx", "server.ts"]
