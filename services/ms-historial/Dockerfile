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

# Exponer puertos HTTP y gRPC
EXPOSE 3005
EXPOSE 50051

# Comando de inicio
CMD ["node", "index.js"]
