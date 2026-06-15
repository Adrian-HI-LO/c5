# Imagen base Node.js LTS
FROM node:18-alpine

# Instalar dependencias del sistema para grpc (compilación nativa)
RUN apk add --no-cache python3 make g++

# Directorio de trabajo
WORKDIR /usr/src/app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto de los archivos
COPY . .

# Exponer puerto HTTP + WebSocket
EXPOSE 3004

# Comando de inicio
CMD ["node", "index.js"]
