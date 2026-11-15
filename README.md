# CRYPTOLEXUZ — BingX public market-data proxy

Backend Node.js listo para desplegar. Permite que la web de CRYPTOLEXUZ consulte datos públicos de BingX desde un servidor, evitando que el navegador llame directamente a BingX.

## Ejecutar localmente
Requiere Node.js 20 o superior.

```bash
npm install
npm start
```

Prueba:
- `GET http://localhost:3000/health`
- `GET http://localhost:3000/api/market/perpetual/ticker/BTC-USDT`
- `GET http://localhost:3000/api/market/spot/ticker/ETH-USDT`
- `GET http://localhost:3000/api/market/perpetual/klines/BTC-USDT?interval=15m&limit=100`
- `GET http://localhost:3000/api/market/spot/klines/ETH-USDT?interval=1h&limit=100`

## Desplegar
1. Sube esta carpeta a un repositorio Git.
2. Crea un servicio web Node en Render, Railway, Fly.io o un VPS.
3. Usa `npm install` como instalación y `npm start` como comando de inicio.
4. Configura `ALLOWED_ORIGIN` con el dominio de CRYPTOLEXUZ. Durante pruebas puede dejarse `*`, pero no es recomendable en producción.
5. Copia la URL HTTPS del servicio y configura el frontend para usarla como base de API.

## Rutas disponibles
- `/health`
- `/api/market/spot/ticker/:symbol`
- `/api/market/perpetual/ticker/:symbol`
- `/api/market/spot/klines/:symbol?interval=15m&limit=100`
- `/api/market/perpetual/klines/:symbol?interval=15m&limit=100`

## Estado y límites
- Consulta únicamente endpoints públicos; no requiere API Key ni Secret Key.
- No opera, no accede a cuentas y no custodia fondos.
- Incluye cotizaciones y velas mediante REST. No incluye todavía un puente WebSocket persistente ni debe anunciarse como streaming en vivo continuo.
- El oro no se mapea a BTC/ETH: requiere confirmar un símbolo de contrato negociable en BingX o contratar un proveedor de XAUUSD.
- Antes de producción, validar los símbolos, límites de frecuencia y esquema de respuesta contra la documentación vigente de BingX.
