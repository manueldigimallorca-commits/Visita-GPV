Recursos locales de Cartera GPV
==============================
utilities.css: utilidades Tailwind CSS 3.4.19 compiladas para este proyecto.
app.css: identidad visual y distribucion responsive.
vendor/xlsx.full.min.js: SheetJS CE 0.20.3 (Apache-2.0).
fonts/public-sans-variable.ttf: Public Sans variable (SIL OFL 1.1).
Licencias y procedencia: ver los archivos LICENSE de cada carpeta.

No se necesita npm ni conexion a un CDN para ejecutar la aplicacion.
Para regenerar las utilidades tras cambiar clases HTML:
  npx --yes tailwindcss@3.4.19 -c tools/tailwind.config.cjs -i styles/utilities.css -o assets/utilities.css --minify
