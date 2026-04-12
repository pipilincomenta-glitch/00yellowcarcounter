# Use Node.js as the base image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package files from backend
COPY backend/package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY backend ./backend
COPY frontend ./frontend

# Change working directory to backend to run the server
WORKDIR /app/backend

# Expose the app port
EXPOSE 3001

# Start the server
CMD ["node", "server.js"]
