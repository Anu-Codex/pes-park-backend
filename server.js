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
    },
    isCaptain: { type: Boolean, default: false }
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
// --- AUCTION TOUR SCHEMAS ---

// 1. Define the Schema
const FixtureSchema = new mongoose.Schema({
    type: { type: String, default: "League" }, // League or Knockout
    playerA: String,
    playerB: String,
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 },
    status: { type: String, default: "Upcoming" } // Upcoming or Completed
});

// 2. Create the Model (This fixes the 'not defined' error)
const AuctionFixture = mongoose.model('AuctionFixture', FixtureSchema);

// --- ADD THESE TOO IF YOU USE SOLO/QUICK/WEEKEND TOURS ---
const SoloFixture = mongoose.model('SoloFixture', FixtureSchema);
const QuickFixture = mongoose.model('QuickFixture', FixtureSchema);
const WeekendFixture = mongoose.model('WeekendFixture', FixtureSchema);
// 2. Tournament Rankings (Golden Boot / Best Players)
const TournamentRankSchema = new mongoose.Schema({
    tour: String,      // "auction", "solo", "weekend"
    category: String,  // "boot" (Goals), "best" (Rating)
    playerName: String,
    teamName: String,
    totalValue: { type: Number, default: 0 }, // Rating or Goals
    matches: { type: Number, default: 0 }
});
const TourRank = mongoose.model('TourRank', TournamentRankSchema);

// --- API ROUTES ---
app.get('/api/auction/fixtures', async (req, res) => res.json(await AuctionFixture.find()));
app.post('/api/auction/fixtures', async (req, res) => {
    await new AuctionFixture(req.body).save();
    res.json({ success: true });
});

app.get('/api/auction/ranks', async (req, res) => res.json(await TourRank.find()));
app.post('/api/auction/ranks', async (req, res) => {
    await TourRank.findOneAndUpdate({category: req.body.category, playerName: req.body.playerName}, req.body, {upsert: true});
    res.json({ success: true });
});

const SoloRank = mongoose.model('SoloRank', new mongoose.Schema({
    category: String, playerName: String, value: Number
}));

// --- SOLO TOUR API ROUTES ---
app.get('/api/solo/fixtures', async (req, res) => res.json(await SoloFixture.find()));
app.post('/api/solo/fixtures', async (req, res) => {
    await new SoloFixture(req.body).save();
    res.json({ success: true });
});

app.get('/api/solo/ranks', async (req, res) => res.json(await SoloRank.find()));
app.post('/api/solo/ranks', async (req, res) => {
    await SoloRank.findOneAndUpdate({category: req.body.category, playerName: req.body.playerName}, req.body, {upsert: true});
    res.json({ success: true });
});

const WeekendRank = mongoose.model('WeekendRank', new mongoose.Schema({
    category: String, playerName: String, value: Number
}));

// --- WEEKEND SERIES API ROUTES ---
app.get('/api/weekend/fixtures', async (req, res) => res.json(await WeekendFixture.find()));
app.post('/api/weekend/fixtures', async (req, res) => {
    await new WeekendFixture(req.body).save();
    res.json({ success: true });
});

app.get('/api/weekend/ranks', async (req, res) => res.json(await WeekendRank.find()));
app.post('/api/weekend/ranks', async (req, res) => {
    await WeekendRank.findOneAndUpdate({category: req.body.category, playerName: req.body.playerName}, req.body, {upsert: true});
    res.json({ success: true });
});

const QuickRank = mongoose.model('QuickRank', new mongoose.Schema({
    category: String, playerName: String, value: Number
}));

// --- QUICK TOUR API ROUTES ---
app.get('/api/quick/fixtures', async (req, res) => res.json(await QuickFixture.find()));
app.post('/api/quick/fixtures', async (req, res) => {
    await new QuickFixture(req.body).save();
    res.json({ success: true });
});

app.get('/api/quick/ranks', async (req, res) => res.json(await QuickRank.find()));
app.post('/api/quick/ranks', async (req, res) => {
    await QuickRank.findOneAndUpdate({category: req.body.category, playerName: req.body.playerName}, req.body, {upsert: true});
    res.json({ success: true });
});
// --- TEAM MANAGEMENT ROUTE ---
app.put('/api/teams/assign', async (req, res) => {
    const { teamName, teamLogo, playerIds } = req.body;
    try {
        // Update all selected players with the new team details
        await Player.updateMany(
            { _id: { $in: playerIds } },
            { $set: { teamName: teamName, teamLogo: teamLogo } }
        );
        res.json({ success: true, message: "Players assigned to team!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/players/:id/captain', async (req, res) => {
    try {
        const { isCaptain } = req.body;
        await Player.findByIdAndUpdate(req.params.id, { isCaptain });
        res.json({ success: true, message: "Captaincy updated!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 1. Team Schema
const TeamSchema = new mongoose.Schema({
    name: String,
    logo: String,
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 }
});
const Team = mongoose.model('Team', TeamSchema);

// 2. Route to get League Leader
app.get('/api/teams/leader', async (req, res) => {
    try {
        const teams = await Team.find();
        if (teams.length === 0) return res.json({ name: "None", points: 0 });

        // Calculate points for each team based on your rules
        const rankedTeams = teams.map(t => {
            const points = (t.wins * 3) + (t.draws * 1) + (t.losses * -2);
            return { name: t.name, points: points };
        });

        // Sort to find the top one
        rankedTeams.sort((a, b) => b.points - a.points);
        res.json(rankedTeams[0]);
    } catch (err) {
        res.status(500).send(err);
    }
});

// 3. Route to update team results (Used by Dashboard)
app.put('/api/teams/update-stats', async (req, res) => {
    const { name, wins, draws, losses } = req.body;
    await Team.findOneAndUpdate({ name }, { wins, draws, losses }, { upsert: true });
    res.json({ success: true });
});
app.get('/api/teams/all', async (req, res) => {
    // This finds all unique team names from your Team schema
    const teams = await Team.find({}, 'name'); 
    res.json(teams);
});
// Add this route to your server.js
app.post('/api/debug', (req, res) => {
    console.log("--- FRONTEND ERROR LOG ---");
    console.log(req.body.error);
    console.log("--------------------------");
    res.json({ success: true });
});
// Replace/Update your Ranking Schema


// API to save/update stats
app.post('/api/tour-ranks', async (req, res) => {
    const { tour, category, playerName, totalValue, matches } = req.body;
    // Get team name from player database automatically
    const player = await Player.findOne({ name: playerName });
    const teamName = player ? player.teamName : "Free Agent";

    await TourRank.findOneAndUpdate(
        { tour, category, playerName },
        { totalValue, matches, teamName },
        { upsert: true }
    );
    res.json({ success: true });
});

// API to get stats
app.get('/api/tour-ranks/:tour/:category', async (req, res) => {
    const data = await TourRank.find({ 
        tour: req.params.tour, 
        category: req.params.category 
    }).sort({ totalValue: -1 });
    res.json(data);
});
// --- DANGER ZONE ROUTES ---

// 1. Reset All Tour Fixtures & Scores
app.delete('/api/danger/reset-tours', async (req, res) => {
    try {
        await AuctionFixture.deleteMany({});
        await SoloFixture.deleteMany({});
        await WeekendFixture.deleteMany({});
        await QuickFixture.deleteMany({});
        res.json({ success: true, message: "All fixtures and scores wiped." });
    } catch (err) { res.status(500).send(err); }
});

// 2. Reset All Rankings (Golden Boot / Best Player)
app.delete('/api/danger/reset-ranks', async (req, res) => {
    try {
        await TourRank.deleteMany({});
        res.json({ success: true, message: "Rankings and Golden Boot data wiped." });
    } catch (err) { res.status(500).send(err); }
});

// 3. Reset Player Financials (Market Value, Auction Price, BDR)
app.put('/api/danger/reset-player-stats', async (req, res) => {
    try {
        await Player.updateMany({}, { 
            $set: { marketValue: 0, auctionPrice: 0, bdrPoints: 0, matches: [] } 
        });
        res.json({ success: true, message: "Player values and match history reset to 0." });
    } catch (err) { res.status(500).send(err); }
});
const StandingSchema = new mongoose.Schema({
    tourId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
    participant: String,
    played: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    points: { type: Number, default: 0 }
});
const Standing = mongoose.model('Standing', StandingSchema);
const TournamentSchema = new mongoose.Schema({
    type: String, // solo, auction, quick, weekend
    name: String, // e.g., "Pro League Season 1"
    participants: [String], // Array of player or team names
    createdAt: { type: Date, default: Date.now }
});
const Tournament = mongoose.model('Tournament', TournamentSchema);
app.post('/api/smart/create-tour', async (req, res) => {
    const { type, name, participants } = req.body;
    const tour = await Tournament.create({ type, name, participants });
    
    // Auto-create point table entries for all participants
    const standingEntries = participants.map(p => ({ tourId: tour._id, participant: p }));
    await Standing.insertMany(standingEntries);
    
    res.json({ success: true, tour });
});

// Update Result & Auto-Calculate Points
app.put('/api/smart/update-score/:fixtureId', async (req, res) => {
    const { scoreA, scoreB } = req.body;
    const fixture = await Fixture.findByIdAndUpdate(req.params.fixtureId, { scoreA, scoreB, status: "Completed" });

    // Points Logic: W=3, D=1, L=0
    const updateStats = async (name, goalsFor, goalsAgainst) => {
        let win = 0, draw = 0, loss = 0, pts = 0;
        if (goalsFor > goalsAgainst) { win = 1; pts = 3; }
        else if (goalsFor === goalsAgainst) { draw = 1; pts = 1; }
        else { loss = 1; pts = 0; }

        await Standing.findOneAndUpdate(
            { tourId: fixture.tourId, participant: name },
            { $inc: { played: 1, wins: win, draws: draw, losses: loss, points: pts } }
        );
    };
    await updateStats(fixture.playerA, scoreA, scoreB);
    await updateStats(fixture.playerB, scoreB, scoreA);
    res.json({ success: true });
});
// Get all tournament names for a specific type
app.get('/api/tournaments/list/:type', async (req, res) => {
    try {
        const tours = await Tournament.find({ type: req.params.type }, 'name _id');
        res.json(tours);
    } catch (err) { res.status(500).json(err); }
});
// 1. Get ALL tournaments (for Dashboard dropdowns)
app.get('/api/smart/tournaments', async (req, res) => {
    try {
        const tours = await Tournament.find().sort({ createdAt: -1 });
        res.json(tours);
    } catch (err) { res.status(500).json(err); }
});

// 2. Get participants for a specific tour (for Fixture dropdowns)
app.get('/api/smart/participants/:tourId', async (req, res) => {
    try {
        const tour = await Tournament.findById(req.params.tourId);
        res.json(tour ? tour.participants : []);
    } catch (err) { res.status(500).json(err); }
});

// 3. Get Standings for a specific tour
app.get('/api/smart/standings/:tourId', async (req, res) => {
    try {
        const data = await Standing.find({ tourId: req.params.tourId });
        res.json(data);
    } catch (err) { res.status(500).json(err); }
});
// Register a player from the global DB into a specific tournament
app.put('/api/smart/register-player', async (req, res) => {
    const { tourId, playerName } = req.body;
    try {
        // 1. Add player to the Tournament participants array
        const tour = await Tournament.findByIdAndUpdate(
            tourId,
            { $addToSet: { participants: playerName } }, // $addToSet prevents duplicates
            { new: true }
        );

        // 2. Create an entry in the Standing (Points Table) for this player in this tour
        const existingStanding = await Standing.findOne({ tourId, participant: playerName });
        if (!existingStanding) {
            await Standing.create({ tourId, participant: playerName });
        }

        res.json({ success: true, message: `${playerName} registered to ${tour.name}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/smart/fixtures/:tourId', async (req, res) => {
    try {
        const fixtures = await Fixture.find({ tourId: req.params.tourId }).sort({ createdAt: -1 });
        res.json(fixtures);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/smart/create-fixture', async (req, res) => {
    try {
        const fixture = await Fixture.create(req.body);
        res.json({ success: true, fixture });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/smart/update-score/:id', async (req, res) => {
    try {
        const { scoreA, scoreB } = req.body;
        const fixture = await Fixture.findById(req.params.id);

        if (fixture.status === "Completed") return res.status(400).json({ message: "Match already recorded" });

        // Update match result
        fixture.scoreA = scoreA;
        fixture.scoreB = scoreB;
        fixture.status = "Completed";
        await fixture.save();

        // Points Logic Helper
        const getStats = (myS, oppS) => {
            if (myS > oppS) return { w: 1, d: 0, l: 0, pts: 3 };
            if (myS === oppS) return { w: 0, d: 1, l: 0, pts: 1 };
            return { w: 0, d: 0, l: 1, pts: 0 };
        };

        const statA = getStats(scoreA, scoreB);
        const statB = getStats(scoreB, scoreA);

        // Update Participant A Table Row
        await Standing.findOneAndUpdate(
            { tourId: fixture.tourId, participant: fixture.playerA },
            { $inc: { played: 1, wins: statA.w, draws: statA.d, losses: statA.l, points: statA.pts } }
        );

        // Update Participant B Table Row
        await Standing.findOneAndUpdate(
            { tourId: fixture.tourId, participant: fixture.playerB },
            { $inc: { played: 1, wins: statB.w, draws: statB.d, losses: statB.l, points: statB.pts } }
        );

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});



const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Admin Server running on ${PORT}`));
