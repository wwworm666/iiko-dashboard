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

// Текущее состояние кранов и история событий
const taps = {};
const events = [];
for (let i = 1; i <= 12; i++) {
    taps[`TAP${i}`] = { status: 'STOP', beer: null };
}

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
    res.json(taps);
});

// Создание события по крану
app.post('/api/taps/:id', (req, res) => {
    const tapId = `TAP${req.params.id}`;
    const { action, beer } = req.body;
    const user = req.body.user || null;
    if (!taps[tapId]) {
        return res.status(404).json({ error: 'Кран не найден' });
    }

    const time = new Date().toISOString();
    let status;
    switch (action) {
        case 'start':
            status = 'ACTIVE';
            taps[tapId] = { status, beer };
            break;
        case 'replace':
            status = 'ACTIVE';
            taps[tapId] = { status, beer };
            break;
        case 'stop':
            status = 'STOP';
            taps[tapId] = { status, beer: null };
            break;
        default:
            return res.status(400).json({ error: 'Неизвестное действие' });
    }

    events.push({ tap: tapId, action: action.toUpperCase(), beer: beer || null, user, time });
    res.json({ status: taps[tapId] });
});

// Отчёт по кранам за период
app.get('/api/taps/history', (req, res) => {
    const { start, end } = req.query;
    const startDate = new Date(start);
    const endDate = new Date(end);

    const report = {};
    const eventsByTap = {};

    for (let i = 1; i <= 12; i++) {
        const tapId = `TAP${i}`;
        const tapEvents = events
            .filter(e => e.tap === tapId && new Date(e.time) <= endDate)
            .sort((a, b) => new Date(a.time) - new Date(b.time));

        eventsByTap[tapId] = tapEvents.filter(e => new Date(e.time) >= startDate);

        let state = 'STOP';
        let lastTime = startDate;
        for (const ev of tapEvents) {
            const t = new Date(ev.time);
            if (t < startDate) {
                state = ev.action === 'STOP' ? 'STOP' : 'ACTIVE';
                continue;
            }
            if (t > endDate) break;
            if (state === 'ACTIVE') {
                report[tapId] = report[tapId] || { active: 0, stop: 0 };
                report[tapId].active += t - lastTime;
            } else {
                report[tapId] = report[tapId] || { active: 0, stop: 0 };
                report[tapId].stop += t - lastTime;
            }
            state = ev.action === 'STOP' ? 'STOP' : 'ACTIVE';
            lastTime = t;
        }
        // завершающий интервал
        if (!report[tapId]) report[tapId] = { active: 0, stop: 0 };
        if (state === 'ACTIVE') {
            report[tapId].active += endDate - lastTime;
        } else {
            report[tapId].stop += endDate - lastTime;
        }

        const total = report[tapId].active + report[tapId].stop;
        report[tapId].active = total ? (report[tapId].active / total) * 100 : 0;
        report[tapId].stop = total ? (report[tapId].stop / total) * 100 : 0;
    }

    res.json({ report, events: eventsByTap });
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
