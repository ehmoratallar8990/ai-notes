FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages packages
RUN npm install
COPY apps/api apps/api
# Build extension and include zip for /api/extension/download
COPY apps/extension apps/extension
RUN cd apps/extension && npm run build && cd dist && zip -r ../extension.zip .
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["npm", "start"]
