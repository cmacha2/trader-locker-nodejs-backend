require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const {
  makeAuthorizedRequest,
  getInstrumentDetails,
  getAccountId,
  calculatePositionSize,
  initAuthentication,
  saveTradeOrderDetails,
  findOrdersBySymbol,
  removeTradeOrderById,
  closeTradeOrder,
  modifyTradeOrder,
  saveModifiedOrders
} = require("./auth");

const app = express();
app.use(bodyParser.json());

app.post("/openTrade", async (req, res) => {
  const { side, symbol, entryPrice, takeProfit, stopLoss } = req.body;

  try {
    // Obtener accountId y accountBalance - asumimos que esta funcionalidad está implementada en auth.js
    const { accountId, accountBalance, accNum } = await getAccountId(); // Asegúrate de que getAccountId() devuelva lo necesario.

    if (!accountBalance) {
      return res.status(500).send("Failed to fetch account balance.");
    }

    // Obtener detalles del instrumento (incluyendo routeId y tradableInstrumentId)
    const instrumentDetails = await getInstrumentDetails(symbol);
    if (!instrumentDetails) {
      return res.status(404).send("Instrument details not found.");
    }

    // Calcular el tamaño de la posición basado en el balance y el riesgo permitido
    const riskPercent = 1; // 1% de riesgo
    const qty = calculatePositionSize(
      accountBalance,
      riskPercent,
      entryPrice,
      stopLoss
    );

    // Construir y enviar la solicitud de operación a TradeLocker
    const tradeDetails = {
      price: entryPrice,
      qty,
      routeId: instrumentDetails.routeId,
      side,
      validity: "GTC",
      type: "limit",
      takeProfit,
      stopLoss,
      stopLossType: "absolute", // Asumiendo que el tipo de stop loss es absoluto
      stopPrice: stopLoss, // asumimos que stopPrice es igual a stopLoss
      takeProfitType: "absolute", // Asumiendo que el tipo de take profit es absoluto
      trStopOffset: 0, // Asumiendo que no usas trailing stop
      tradableInstrumentId: instrumentDetails.tradableInstrumentId,
    };

    // Justo antes de llamar a makeAuthorizedRequest

    // Llamada a makeAuthorizedRequest
    const response = await makeAuthorizedRequest(
      "POST",
      `/trade/accounts/${accountId}/orders`,
      tradeDetails,
      accNum
    );
     // Asume que el orderId viene en la respuesta
     // Adaptar según la estructura real de tu respuesta
if(response.data && response.data.d && response.data.d.orderId) {
    const orderDetails = {
        id: response.data.d.orderId,
        symbol,
        side,
        entryPrice,
        takeProfit,
        stopLoss
    };
    await saveTradeOrderDetails(orderDetails);
    res.json({ success: true, data: response.data || response });
} else {
    throw new Error("Failed to obtain orderId from the response");
}

  } catch (error) {
    // Extrae solo la información relevante del error para evitar estructuras circulares
    const errorMessage = error.message;
    const errorDetails = {
      status: error.response?.status, // Estado HTTP, si existe
      data: error.response?.data, // Respuesta del servidor, si existe
    };

    // Registro del error con detalles específicos, evitando la estructura circular
    console.error("Error opening trade:", errorMessage, errorDetails);

    // Envía una respuesta sin incluir el objeto de error completo
    res.status(500).json({
      success: false,
      message: "Failed to open trade. Please try again.",
      error: errorMessage, // Mensaje del error
      details: errorDetails, // Detalles específicos extraídos
    });
  }
});


app.delete("/closeTrade", async (req, res) => {
    const { symbol } = req.body;
    try {
        const orders = await findOrdersBySymbol(symbol);
        console.log("Orders found:", orders);
        if (orders.length === 0) {
            return res.status(404).send("No orders found for the given symbol.");
        }
        
        for (const order of orders) {
            const response = await closeTradeOrder(order.id, 1); // Asume accNum es 1
            if (response.s === "ok") {
                await removeTradeOrderById(order.id);
            } else {
                console.error("Failed to close order:", order.id);
                // Considera cómo manejar fallos parciales
            }
        }
        res.json({ success: true, message: "Orders closed successfully." });
    } catch (error) {
        console.error("Error closing trades:", error.message);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to close trades."
        });
    }
});


app.patch("/modifyTrade", async (req, res) => {
    const { symbol, takeProfit, stopLoss, breakEven } = req.body;

    try {
        // Encuentra todas las órdenes con el símbolo dado en el archivo JSON
        const orders = await findOrdersBySymbol(symbol);
        if (orders.length === 0) {
            return res.status(404).send("No orders found for the given symbol.");
        }

        // Itera sobre las órdenes encontradas y modifica cada una según los parámetros proporcionados
        for (const order of orders) {
            let modificationParams = {};

            if (breakEven) {
                // Ajusta SL al punto de entrada para las órdenes que coinciden
                modificationParams = {
                    stopLoss: order.entryPrice,
                    takeProfit: order.takeProfit,
                    // El stopPrice generalmente es lo mismo que stopLoss en este contexto
                    stopPrice: order.entryPrice,
                };
                // También actualiza el JSON guardado con el nuevo SL
                order.stopLoss = order.entryPrice;
            } else {
                // Modifica la orden con takeProfit y stopLoss si están presentes
                if (takeProfit) modificationParams.takeProfit = takeProfit;
                if (stopLoss) modificationParams.stopLoss = stopLoss;
            }

            // Llama a la API para modificar la orden
            console.log(order.id, 1, modificationParams);
            await modifyTradeOrder(order.id, 1, modificationParams);
        }

        // Guarda las modificaciones en el archivo JSON después de iterar todas las órdenes
        await saveModifiedOrders(orders);

        res.json({ success: true, message: "Orders modified successfully." });
    } catch (error) {
        console.error("Error modifying trades:", error.message);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to modify trades."
        });
    }
});



// Ruta de prueba para verificar que el servidor está funcionando
app.get("/", (req, res) => {
  res.send("TradeLocker Bot Server is running.");
});

// Iniciar el servidor después de asegurar la autenticación
initAuthentication()
  .then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Authentication failed:", error);
  });
