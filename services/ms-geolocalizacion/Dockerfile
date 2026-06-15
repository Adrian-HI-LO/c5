# Usar una imagen base de Node.js
FROM node:18-alpine

# Establecer el directorio de trabajo en el contenedor
WORKDIR /usr/src/app

# Copiar los archivos de definición de paquetes
COPY package*.json ./

# Instalar las dependencias del proyecto
# En un entorno de producción, se usaría 'npm ci' para instalaciones más rápidas y fiables
RUN npm install

# Copiar el resto de los archivos de la aplicación
COPY . .

# El puerto se expondrá en el docker-compose.yml

# Comando para iniciar la aplicación
CMD [ "node", "index.js" ]
