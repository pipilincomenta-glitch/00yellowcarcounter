FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY backend ./backend
COPY frontend ./frontend
WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "server.js"]
