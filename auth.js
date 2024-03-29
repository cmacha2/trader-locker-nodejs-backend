// auth.js
const axios = require('axios');
const fs = require('fs-extra');
const API_BASE_URL = process.env.TRADELOCKER_API_URL;
const TOKENS_PATH = './tokens.json';
const path = require('path');

let accessToken = '';
let refreshToken = '';
let tokenExpiryDate = null;
let accountId = '';
let accNum = '';

async function saveTokens(tokens) {
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
    tokenExpiryDate = new Date(tokens.expireDate);
    await fs.writeJson(TOKENS_PATH, { accessToken, refreshToken, tokenExpiryDate: tokenExpiryDate.toISOString() });
}

async function loadTokens() {
    if (await fs.pathExists(TOKENS_PATH)) {
        const tokens = await fs.readJson(TOKENS_PATH);
        accessToken = tokens.accessToken;
        refreshToken = tokens.refreshToken;
        tokenExpiryDate = new Date(tokens.tokenExpiryDate);
    }
}

async function authenticate() {
    try {
        const response = await axios.post(`${API_BASE_URL}/auth/jwt/token`, {
            email: process.env.TRADELOCKER_EMAIL,
            password: process.env.TRADELOCKER_PASSWORD,
            server: process.env.TRADELOCKER_SERVER,
        });

        console.log('Authenticated successfully');
        await saveTokens(response.data);
       // await fetchAndStoreInstrumentDetails(); // Asumiendo que implementas esta función para obtener y almacenar los detalles de los instrumentos
    } catch (error) {
        console.error('Authentication failed:', error.response ? error.response.data : error.message);
    }
}


const makeAuthorizedRequest = async (method, url, data = {}, accNum=null) => {
    const config = {
        method: method,
        url: `${API_BASE_URL}${url}`,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            "accNum": accNum && parseInt(accNum)
        },
        data: data,
        
    }

    try {
        return await axios(config);
    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.log('Token expired, refreshing...');
            await authenticate();
            config.headers['Authorization'] = `Bearer ${accessToken}`;
            return await axios(config);
        } else {
            throw error;
        }
    }
};



// Función para obtener el routeId y tradableInstrumentId basado en el símbolo del instrumento
async function getInstrumentDetails(symbol) {
    const instruments = await fs.readJson('./instruments.json');
    const instrument = instruments.find(inst => inst.name === symbol); // Ajusta la propiedad 'name' según la respuesta real de tu API
    return instrument ? { routeId: instrument.routes[0].id
        , tradableInstrumentId: instrument.tradableInstrumentId } : null;
}


// Función para calcular el tamaño de la posición basado en el riesgo y el balance de la cuenta
function calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLoss) {
    // Convertir la diferencia entre el precio de entrada y el stop loss a pips
    const pipsRisk = Math.abs(entryPrice - stopLoss) * 10000; // Multiplicar por 10000 para EURUSD
    const riskAmount = accountBalance * (riskPercent / 100); // Cantidad de dinero a arriesgar

    // Valor por pip para un lote estándar en EURUSD es aproximadamente $10
    // Esto puede variar y debería ajustarse según la moneda de la cuenta y el tamaño del contrato
    const valuePerPip = 10;

    // Calcular el tamaño de la posición basado en el riesgo por operación y el pips de riesgo
    const positionSize = riskAmount / (pipsRisk * valuePerPip);

    // Redondear y formatear el tamaño de la posición a dos dígitos después del punto decimal
    const formattedPositionSize = parseFloat(positionSize.toFixed(2));
    
    console.log('Pips de Riesgo:', pipsRisk);
    console.log('Cantidad a Riesgo:', riskAmount);
    console.log('Valor por Pip:', valuePerPip);
    console.log('Tamaño de la Posición (en lotes):', formattedPositionSize);
    
    return formattedPositionSize;
}



async function initAuthentication() {
    await loadTokens();
    const now = new Date();
    const expiresIn = tokenExpiryDate ? tokenExpiryDate.getTime() - now.getTime() : 0;
    const shouldRefresh = expiresIn < 5 * 60 * 1000;

    if (!accessToken || shouldRefresh) {
        console.log('Token is missing or expiring soon, re-authenticating...');
        await authenticate();
    }
}

async function getAccountId() {
    const {data} = await makeAuthorizedRequest('GET', '/auth/jwt/all-accounts');
    
     accountId = data.accounts[0].id;
     accNum = data.accounts[0].accNum;
     const accountBalance = data.accounts[0].accountBalance;

    return {
        accountId,
        accNum,
        accountBalance
    }
}


async function saveTradeOrderDetails(orderDetails) {
    const filePath = path.join(__dirname, 'tradeIds.json');
    let currentData = { orders: [] };
    try {
        if (fs.existsSync(filePath)) {
            currentData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.log('Creating new file for trade data.');
    }
    currentData.orders.push(orderDetails);
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf8');
}

  

  async function findOrdersBySymbol(symbol) {
    const filePath = path.join(__dirname, 'tradeIds.json');
    try {
        const currentData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const orders = currentData.orders.filter(order => order.symbol === symbol);
        return orders;
    } catch (error) {
        console.error("Error finding orders by symbol:", error);
        return [];
    }
}


async function closeTradeOrder(orderId, accNum) {
    try {
        const response = await makeAuthorizedRequest('DELETE', `/trade/orders/${orderId}`, {}, accNum);
        if (response.s === "ok") {
            await removeTradeOrderById(orderId); // Función para eliminar la orden por ID
        }
        return response.data;
    } catch (error) {
        console.error("Error closing order:", error);
        throw new Error(`Failed to close order: ${error?.response?.data?.message || error.message}`);
    }
}


async function removeTradeOrderById(orderId) {
    const filePath = path.join(__dirname, 'tradeIds.json');
    try {
        const currentData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        currentData.orders = currentData.orders.filter(order => order.id !== orderId);
        fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf8');
        console.log(`Order with ID ${orderId} removed successfully.`);
    } catch (error) {
        console.error("Error removing order by ID:", error);
        throw new Error(`Failed to remove order by ID ${orderId}: ${error.message}`);
    }
}


async function saveModifiedOrders(modifiedOrders) {
    const filePath = path.join(__dirname, 'tradeIds.json');
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Asumiendo que data.orders es un arreglo de órdenes
        // Actualizar cada orden en data.orders con las modificaciones realizadas
        const updatedOrders = data.orders.map(order => {
            const modifiedOrder = modifiedOrders.find(modOrder => modOrder.id === order.id);
            return modifiedOrder ? modifiedOrder : order;
        });

        data.orders = updatedOrders;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving modified orders:", error);
        throw new Error(`Failed to save modified orders: ${error.message}`);
    }
}


async function modifyTradeOrder(orderId, accNum, modificationParams) {

    console.log(`Modifying order ${orderId} with parameters:`, modificationParams);
    // Preparar el cuerpo de la solicitud en función de los parámetros de modificación
    const requestBody = {
        ...(modificationParams.takeProfit && {takeProfit: modificationParams.takeProfit}),
        ...(modificationParams.stopLoss && {stopLoss: modificationParams.stopLoss}),
        ...(modificationParams.stopPrice && {stopPrice: modificationParams.stopPrice}),
        // Añade más campos según sean necesarios de acuerdo a la documentación de tu API
        validity: "GTC" // Este valor es constante en tu ejemplo, pero ajusta según necesites
    };

    try {
        const response = await makeAuthorizedRequest(
            'PATCH',
            `/trade/orders/${orderId}`,
            requestBody,
            accNum
        );

        console.log(response.data);

        // Verificar la respuesta y retornar un objeto apropiado
        // La estructura de este objeto dependerá de cómo tu API señale una operación exitosa
        // if (response && response.s === "ok") {
        //     console.log(`Order ${orderId} modified successfully.`);
        //     return { s: "ok" };
        // } else {
        //     // Manejo de respuestas no exitosas
        //     console.error(`Failed to modify order ${orderId}.`, response);
        //     throw new Error(`API response: ${response.s}`);
        // }
    } catch (error) {
        console.error("Error modifying order:", orderId, error);
        throw error; // Relanza el error para manejarlo en el nivel superior
    }
}




module.exports = {
    initAuthentication,
    authenticate,
    makeAuthorizedRequest,
    getAccountId,
    getInstrumentDetails,
    calculatePositionSize,
    saveTradeOrderDetails,
    findOrdersBySymbol,
    removeTradeOrderById,
    closeTradeOrder,
    saveModifiedOrders,
    modifyTradeOrder
    // Asegúrate de exportar también las nuevas funciones aquí
};
