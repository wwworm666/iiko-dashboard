const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const app = express();

// Парсим JSON из запросов
app.use(express.json());

// ВАЖНО: указываем полный путь к папке public
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище названий пива (глобальный список)
const BEER_NAMES_FILE = path.join(__dirname, 'beer-names.json');
let beerNames = [];
try {
    beerNames = JSON.parse(fs.readFileSync(BEER_NAMES_FILE, 'utf8'));
    if (!Array.isArray(beerNames)) beerNames = [];
} catch (e) {
    beerNames = [];
}

// Текущее состояние кранов по барам и история событий
const BAR_CODES = ['krem', 'var', 'vas', 'lig'];
const taps = {};
const events = [];

function initBar(code) {
    taps[code] = {};
    for (let i = 1; i <= 12; i++) {
        taps[code][`TAP${i}`] = { state: 'STOP', beer_name: null };
    }
}

BAR_CODES.forEach(initBar);

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

// Эндпоинты для названий пива
app.get('/api/beer-names', (req, res) => {
    res.json(beerNames);
});

app.post('/api/beer-names', (req, res) => {
    let name = (req.body.name || '').trim();
    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }
    const exists = beerNames.some(b => b.toLowerCase() === name.toLowerCase());
    if (!exists) {
        beerNames.push(name);
        try {
            fs.writeFileSync(BEER_NAMES_FILE, JSON.stringify(beerNames, null, 2));
        } catch (e) {
            console.error('Error writing beer names file', e);
        }
    }
    res.json(beerNames);
});

// Текущие состояния кранов
app.get('/api/taps', (req, res) => {
    const bar = req.query.bar;
    if (!bar || !taps[bar]) {
        return res.status(400).json({ error: 'Unknown bar' });
    }
    res.json(taps[bar]);
});

// Создание события по крану
app.post('/api/taps/event', (req, res) => {
    const { bar, tap, event, beer_name, who, ts } = req.body;
    if (!bar || !taps[bar] || !taps[bar][tap]) {
        return res.status(400).json({ error: 'Unknown bar or tap' });
    }

    const time = ts ? new Date(ts).toISOString() : new Date().toISOString();

    switch (event) {
        case 'START':
            taps[bar][tap] = { state: 'ACTIVE', beer_name };
            break;
        case 'STOP':
            taps[bar][tap] = { state: 'STOP', beer_name: null };
            break;
        case 'CHANGE':
            taps[bar][tap] = { state: 'ACTIVE', beer_name };
            break;
        default:
            return res.status(400).json({ error: 'Unknown event' });
    }

    events.push({ bar, tap, event, beer_name: beer_name || null, who: who || null, ts: time });
    res.json(taps[bar][tap]);
});

// История событий по бару
app.get('/api/taps/history', (req, res) => {
    const { bar, from, to } = req.query;
    if (!bar || !taps[bar]) {
        return res.status(400).json({ error: 'Unknown bar' });
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const list = events
        .filter(e => e.bar === bar && new Date(e.ts) >= fromDate && new Date(e.ts) <= toDate)
        .sort((a, b) => new Date(a.ts) - new Date(b.ts));
    res.json(list);
});

// Маршруты страниц для баров
BAR_CODES.forEach(code => {
    app.get(`/${code}`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'bar.html'));
    });
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
