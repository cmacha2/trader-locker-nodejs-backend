const axios = require('axios');
const fs = require('fs-extra');
const API_BASE_URL = process.env.TRADELOCKER_API_URL;
const TOKENS_PATH = './tokens.json';

let accessToken = '';
let refreshToken = '';
let accountId = '';

// Función para cargar tokens de acceso y refreshToken desde un archivo local
async function loadTokens() {
    if (await fs.pathExists(TOKENS_PATH)) {
        const tokens = await fs.readJson(TOKENS_PATH);
        accessToken = tokens.accessToken;
        refreshToken = tokens.refreshToken;
    }
}

// Función para guardar tokens de acceso y refreshToken en un archivo local
async function saveTokens(tokens) {
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
    await fs.writeJson(TOKENS_PATH, { accessToken, refreshToken });
}

// Función para autenticarse y obtener tokens
async function authenticate() {
    try {
        const response = await axios.post(`${API_BASE_URL}/auth/jwt/token`, {
            email: process.env.TRADELOCKER_EMAIL,
            password: process.env.TRADELOCKER_PASSWORD,
            server: process.env.TRADELOCKER_SERVER,
        });

        console.log('Authenticated successfully');
        await saveTokens(response.data);
    } catch (error) {
        console.error('Authentication failed:', error);
    }
}

// Función para realizar solicitudes autorizadas a TradeLocker
async function makeAuthorizedRequest(method, url, data = {}) {
    await loadTokens(); // Asegúrate de que los tokens están cargados
    const config = {
        method,
        url: `${API_BASE_URL}${url}`,
        headers: { 'Authorization': `Bearer ${accessToken}` },
        data,
    };

    try {
        const response = await axios(config);
        return response;
    } catch (error) {
        console.error('Error making authorized request:', error);
        throw error;
    }
}

// Función para obtener y almacenar los detalles de los instrumentos disponibles
async function fetchAndStoreInstrumentDetails(accountId) {
    const response = await makeAuthorizedRequest('GET', `/trade/accounts/${accountId}/instruments`);
    await fs.writeJson('./instruments.json', response.data);
    console.log("Instrument details fetched and stored.");
}

// Función para obtener el routeId y tradableInstrumentId basado en el símbolo del instrumento
async function getInstrumentDetails(symbol) {
    const instruments = await fs.readJson('./instruments.json');
    const instrument = instruments.find(inst => inst.name === symbol); // Ajusta la propiedad 'name' según la respuesta real de tu API
    return instrument ? { routeId: instrument.routeId, tradableInstrumentId: instrument.id } : null;
}

// Función para obtener el balance de la cuenta
async function fetchAccountBalance(accountId) {
    const response = await makeAuthorizedRequest('GET', `/trade/accounts/${accountId}`);
    return response.data.balance; // Ajusta 'balance' según la estructura de la respuesta de tu API
}

// Función para calcular el tamaño de la posición basado en el riesgo y el balance de la cuenta
function calculatePositionSize(balance, riskPercent, entryPrice, stopLoss) {
    const riskAmount = balance * (riskPercent / 100);
    const pipDifference = Math.abs(entryPrice - stopLoss);
    // Asume que necesitas ajustar el cálculo del tamaño de la posición según la denominación y el valor por pip del instrumento
    return riskAmount / pipDifference; // Este es un ejemplo simplificado
}

module.exports = {authenticate,
    makeAuthorizedRequest,
    loadTokens,
    saveTokens, fetchAndStoreInstrumentDetails, getInstrumentDetails, fetchAccountBalance, calculatePositionSize, makeAuthorizedRequest };





    const makeAuthorizedRequest = async (method, url, data = {}, accNum=null) => {
        console.log(method, url, data, accNum)
        const config = {
            method: method,
            url: `${API_BASE_URL}${url}`,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'accNum': accNum, // Agregar el accNum al encabezado de la solicitud
            },
            data: data,
        };
    
        console.log('Making authorized request:',
            `${method.toUpperCase()} ${url}`,
            data ? `Data: ${JSON.stringify(data)}` : '');
    
        try {
            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error('Request failed:', error.response ? error.response.data : error.message);
            throw error;
        }
    };