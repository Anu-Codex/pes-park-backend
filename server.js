const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/efootball');

// --- SCHEMAS ---

// Player Schema
// Expand the Player Schema
const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    nickname: String,
    image: String,
    teamName: String,
    teamLogo: String,
    
    // Financials & Points
    auctionPrice: { type: Number, default: 0 },
    marketValue: { type: Number, default: 0 },
    bdrPoints: { type: Number, default: 0 },
    squadImage: String,

    // Match Records (Structured for H2H calculation)
    matches: [{
        opponentName: String,
        myScore: Number,
        oppScore: Number,
        result: String, // WIN, LOSS, DRAW
        date: { type: Date, default: Date.now } // Store as actual Date for sorting
    }],

    // Season Summary (Manual totals)
    seasonStats: {
        wins: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        goals: { type: Number, default: 0 }
    },

    // Trophies count
    trophies: {
        ballonDor: { type: Number, default: 0 },
        ucl: { type: Number, default: 0 },
        league: { type: Number, default: 0 },
        weekly: { type: Number, default: 0 },
        goldenBoot: { type: Number, default: 0 }
    }
});

const Player = mongoose.model('Player', PlayerSchema);

// GET Single Player by ID
app.get('/api/players/:id', async (req, res) => {
    const player = await Player.findById(req.params.id);
    res.json(player);
});

// UPDATE Player Stats (Dashboard)
app.put('/api/players/:id', async (req, res) => {
    await Player.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
});
// Stats Schema (To control the Blue Area from your first image)
const StatsSchema = new mongoose.Schema({
    bdrLeader: String,
    bdrValue: Number,
    highestMV: String,
    mvValue: Number,
    teamsCount: Number,
    playersCount: Number
});
const Stats = mongoose.model('Stats', StatsSchema);

// --- ROUTES ---

// Players API
app.get('/api/players', async (req, res) => res.json(await Player.find()));
app.post('/api/players', async (req, res) => {
    const newPlayer = new Player(req.body);
    await newPlayer.save();
    res.json({ success: true });
});
app.delete('/api/players/:id', async (req, res) => {
    await Player.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// Stats API
app.get('/api/stats', async (req, res) => {
    let stats = await Stats.findOne();
    if (!stats) stats = await Stats.create({ bdrLeader: "None", bdrValue: 0, highestMV: "None", mvValue: 0, teamsCount: 0, playersCount: 0 });
    res.json(stats);
});

app.put('/api/stats', async (req, res) => {
    await Stats.findOneAndUpdate({}, req.body);
    res.json({ success: true });
});

// Add these to your existing server.js

const ADMIN_EMAIL = "admin@tamil.com";
const ADMIN_PASS = "admin123"; // You should use environment variables for this!

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});
// --- NEW HALL OF FAME SCHEMA ---
const AchievementSchema = new mongoose.Schema({
    season: String,
    winnerName: String,
    winnerImage: String,
    teamName: String,
    title: { type: String, default: "Champion" } // e.g., Champion, Runner Up, MVP
});
const Achievement = mongoose.model('Achievement', AchievementSchema);

// --- ROUTES ---
app.get('/api/achievements', async (req, res) => res.json(await Achievement.find().sort({ season: -1 })));

app.post('/api/achievements', async (req, res) => {
    const newAchieve = new Achievement(req.body);
    await newAchieve.save();
    res.json({ success: true });
});

app.delete('/api/achievements/:id', async (req, res) => {
    await Achievement.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});
app.post('/api/players/:id/matches', async (req, res) => {
    const { opponentName, myScore, oppScore } = req.body;
    let result = "DRAW";
    if (myScore > oppScore) result = "WIN";
    else if (myScore < oppScore) result = "LOSS";

    const matchEntry = { opponentName, myScore, oppScore, result };
    
    await Player.findByIdAndUpdate(req.params.id, { $push: { matches: { $each: [matchEntry], $position: 0 } } });
    res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Admin Server running on ${PORT}`));
