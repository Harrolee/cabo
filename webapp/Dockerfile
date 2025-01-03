# Build stage
FROM node:18-alpine as build

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY index.html .
COPY index.js .

# Production stage
FROM nginx:alpine

# Copy built files from build stage
COPY --from=build /app /usr/share/nginx/html

# Copy custom nginx config if needed
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"] 