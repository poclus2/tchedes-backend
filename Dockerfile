FROM node:20-bullseye

# Install necessary build tools for native dependencies (like face-api and node-gyp)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for TypeScript build)
RUN npm install
# Inject native Linux TensorFlow bindings directly into the container
RUN npm install @tensorflow/tfjs-node

# Copy source code and Prisma schema
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript code
RUN npm run build

# Expose API port
EXPOSE 3000

# Default command (can be overridden in docker-compose for worker)
CMD ["npm", "start"]
