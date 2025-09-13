const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();

// ВАЖНО: указываем полный путь к папке public
app.use(express.static(path.join(__dirname, 'public')));

// Конфигурация iikoServer
const IIKO_CONFIG = {
    baseUrl: 'https://localhost:443',
    // Отключаем проверку SSL для локального сервера
    httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false
    })
};

// Данные для дашборда
const dashboardData = {
    kremenchug: {
        revenue: 1245000,
        margin: 42.5,
        profit: 529125,
        checks: 3456,
        avgCheck: 360,
        tapStatus: 'Работает',
        tapShare: 35.2,
        packShare: 45.8,
        kitchenShare: 19.0
    },
    warsaw: {
        revenue: 986000,
        margin: 38.2,
        profit: 376652,
        checks: 2890,
        avgCheck: 341,
        tapStatus: 'Остановлен',
        tapShare: 28.5,
        packShare: 52.3,
        kitchenShare: 19.2
    }
};

// Функция для получения данных из iikoServer
async function getIikoData(location) {
    try {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        
        // Получение продаж за день
        const salesResponse = await axios.get(`${IIKO_CONFIG.baseUrl}/resto/api/v2/reports/sales`, {
            params: {
                from: startOfDay.toISOString(),
                to: endOfDay.toISOString(),
                groupBy: 'Department'
            },
            httpsAgent: IIKO_CONFIG.httpsAgent
        });
        
        // Получение информации о кассах
        const cashResponse = await axios.get(`${IIKO_CONFIG.baseUrl}/resto/api/cash`, {
            httpsAgent: IIKO_CONFIG.httpsAgent
        });
        
        const salesData = salesResponse.data;
        const cashData = cashResponse.data;
        
        // Расчет метрик
        const revenue = salesData.reduce((sum, item) => sum + (item.sum || 0), 0);
        const checks = salesData.reduce((sum, item) => sum + (item.count || 0), 0);
        const avgCheck = checks > 0 ? revenue / checks : 0;
        
        return {
            revenue: Math.round(revenue),
            margin: 42.5, // Пока статичная маржа
            profit: Math.round(revenue * 0.425),
            checks: checks,
            avgCheck: Math.round(avgCheck),
            tapStatus: 'Работает',
            tapShare: 35.2,
            packShare: 45.8,
            kitchenShare: 19.0
        };
        
    } catch (error) {
        console.error('Ошибка получения данных из iikoServer:', error.message);
        throw error;
    }
}

// API endpoint
app.get('/api/data/:location', async (req, res) => {
    try {
        const location = req.params.location;
        const data = await getIikoData(location);
        res.json(data);
    } catch (error) {
        res.status(500).json({
            error: 'Ошибка получения данных из iikoServer',
            message: error.message,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен!`);
    console.log(`📊 Откройте в браузере: http://localhost:${PORT}`);
    console.log(`🛑 Для остановки нажмите Ctrl+C`);
});
