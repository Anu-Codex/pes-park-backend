require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const SibApiV3Sdk = require('sib-api-v3-sdk');
const bcrypt = require('bcryptjs');


const app = express();

// 1. ADD THIS: Allow your website to talk to the server
app.use(cors({ origin: "*" })); 

// 2. ADD THIS: Allow the server to read the email/password you send
app.use(cors({ origin: "*" })); 
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/efootball');

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY; // Ensure this is in Render Env Vars
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// --- SCHEMAS ---
const { exec } = require('child_process');
const os = require('os');

app.get('/api/system/stats', (req, res) => {
    // Command to check disk space in the current directory (.)
    exec('df -h .', (err, stdout) => {
        let diskData = { total: "N/A", used: "N/A", free: "N/A", percent: "0" };
        
        if (!err) {
            const lines = stdout.split('\n');
            const stats = lines[1].replace(/\s+/g, ' ').split(' ');
            // stats[1]=Total, stats[2]=Used, stats[3]=Free, stats[4]=Usage%
            diskData = {
                total: stats[1],
                used: stats[2],
                free: stats[3],
                percent: stats[4].replace('%', '')
            };
        }

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        res.json({
            success: true,
            ram: {
                total: (totalMem / (1024 ** 3)).toFixed(2) + " GB",
                used: (usedMem / (1024 ** 3)).toFixed(2) + " GB",
                free: (freeMem / (1024 ** 3)).toFixed(2) + " GB",
                percent: ((usedMem / totalMem) * 100).toFixed(1)
            },
            disk: diskData, // NEW DISK DATA
            server: {
                platform: os.platform(),
                region: process.env.RENDER_REGION || "Frankfurt (EU)",
                uptime: Math.floor(process.uptime())
            }
        });
    });
});
// Player Schema
// Expand the Player Schema
const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    nickname: String,
    image: String,
    backgroundImage: String,
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
    attributes: {
        consistency: { type: Number, default: 50 },
        bigMatch: { type: Number, default: 50 },
        scoring: { type: Number, default: 50 },
        playmaking: { type: Number, default: 50 },
        defense: { type: Number, default: 50 },
        mental: { type: Number, default: 50 }
    },

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
        quickTour: { type: Number, default: 0 }, 
        soloBoot: { type: Number, default: 0 },  
        auctionBoot: { type: Number, default: 0 }
    },
    isCaptain: { type: Boolean, default: false },
    customTrophies: [{
        name: String,
        image: String,
        awardedAt: { type: Date, default: Date.now }
    }]
});

const Player = mongoose.model('Player', PlayerSchema);

// GET Single Player by ID
app.get('/api/players/:id', async (req, res) => {
    const player = await Player.findById(req.params.id);
    res.json(player);
});

// --- SMART PLAYER UPDATE (WITH NAME CASCADE) ---
app.put('/api/players/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const newData = req.body;

        // 1. Find the player's CURRENT name before we change it
        const player = await Player.findById(id);
        if (!player) return res.status(404).json({ success: false, message: "Player not found" });

        const oldName = player.name;
        const newName = newData.name;

        // 2. Perform the main update on the Player document
        await Player.findByIdAndUpdate(id, newData);

        // 3. IF THE NAME CHANGED: Update all other collections automatically
        if (newName && oldName !== newName) {
            console.log(`Cascading name change: ${oldName} -> ${newName}`);

            // A. Update Fixtures (Matches)
            const Fixture = mongoose.models.Fixture;
            await Fixture.updateMany({ playerA: oldName }, { $set: { playerA: newName } });
            await Fixture.updateMany({ playerB: oldName }, { $set: { playerB: newName } });

            // B. Update Tournament Standings (Points Table)
            const Standing = mongoose.models.Standing;
            await Standing.updateMany({ participant: oldName }, { $set: { participant: newName } });

            // C. Update Tournament Rankings (Golden Boot / Best Player)
            const TourRank = mongoose.models.TourRank;
            await TourRank.updateMany({ playerName: oldName }, { $set: { playerName: newName } });

            // D. Update Transfer Market Listings
            const TransferListing = mongoose.models.TransferListing;
            await TransferListing.updateMany({ playerName: oldName }, { $set: { playerName: newName } });
        }

        res.json({ success: true, message: "Player and all related records updated!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// --- FETCH SINGLE TOURNAMENT DATA ---
app.get('/api/smart/tournament-details/:id', async (req, res) => {
    try {
        const tour = await Tournament.findById(req.params.id);
        if (!tour) return res.status(404).json({ error: "Tournament not found" });
        res.json(tour);
    } catch (err) {
        res.status(500).json({ error: "Invalid ID" });
    }
});
// NEW: Optimized "All-in-One" Dressing Room Data
app.get('/api/v2/dressing-room/:teamName', async (req, res) => {
    try {
        const { teamName } = req.params;

        // Run all DB queries in parallel for maximum speed
        const [teamData, allTeams, allListings] = await Promise.all([
            // Query 1: Team & Players
            (async () => {
                const T = mongoose.connection.db.collection('teams');
                const P = mongoose.connection.db.collection('players');
                const team = await T.findOne({ name: teamName });
                // Optimization: Use exact match instead of heavy regex if possible
                const players = await P.find({ soldTo: { $regex: new RegExp('^' + teamName, 'i') } }).toArray();
                return { team, players };
            })(),
            // Query 2: All Teams (for dropdown)
            mongoose.model('Team').find({}, 'name'),
            // Query 3: Market Listings
            mongoose.models.TransferListing.find() 
        ]);

        // Filter offers in backend (faster than frontend)
        const myOffers = allListings.filter(l => 
            l.targetTeam === teamName || (l.targetTeam === "General" && l.fromTeam !== teamName)
        );

        res.json({
            team: teamData.team,
            players: teamData.players,
            allTeams: allTeams.filter(t => t.name !== teamName),
            offers: myOffers
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 1. Add to Player Schema (if not already there)
// isOnTransferList: { type: Boolean, default: false },
// transferPrice: { type: Number, default: 0 }
// --- FIXED MISTRAL SCOUTING ROUTE ---
app.post('/api/bot/scout-player', async (req, res) => {
    try {
        const { name, attributes, marketValue, bdrPoints } = req.body;
        
        // Ensure Mistral is initialized
        if (!mistral) return res.status(500).json({ report: "AI Neural Link Offline." });

        const prompt = `Act as an eSports Head Scout. Generate a tactical dossier for:
        PLAYER: ${name}
        VALUATION: ${marketValue}M
        BDR: ${bdrPoints}
        STATS: Consistency:${attributes.consistency}, BigMatch:${attributes.bigMatch}, Scoring:${attributes.scoring}, Playmaking:${attributes.playmaking}, Defense:${attributes.defense}, Mental:${attributes.mental}.
        Write 2-3 aggressive, professional eSports sentences. Highlight their strongest trait.`;

        const chatResponse = await mistral.chat({
            model: 'mistral-tiny',
            messages: [{ role: 'user', content: prompt }]
        });

        const report = chatResponse.choices[0].message.content;
        res.json({ report });
    } catch (err) {
        console.error("Mistral Scout Error:", err);
        res.status(500).json({ report: "Tactical Data Transmission Interrupted." });
    }
});
// --- IMPROVED TEAM & LOGO SYNC ---
app.get('/api/danger/import-team-data', async (req, res) => {
    try {
        const pesPlayers = await Player.find();
        const AuctionPlayers = mongoose.connection.db.collection('players');
        const AuctionTeams = mongoose.connection.db.collection('teams');
        let count = 0;

        for (let p of pesPlayers) {
            // Find player in Auction DB (Case Insensitive)
            const aPlayer = await AuctionPlayers.findOne({ 
                name: { $regex: new RegExp("^" + p.name + "$", "i") } 
            });

            if (aPlayer && aPlayer.soldTo && aPlayer.soldTo !== '-' && aPlayer.soldTo !== 'UNSOLD') {
                // 1. Extract Team Name (e.g., "Manchester City (200M)" -> "Manchester City")
                const teamName = aPlayer.soldTo.split(' (')[0].trim();
                
                // 2. Fetch Logo for this team from the auction 'teams' collection
                const teamInfo = await AuctionTeams.findOne({ name: teamName });
                
                // Check multiple possible fields for logo
                const teamLogo = teamInfo ? (teamInfo.logoUrl || teamInfo.logo || "") : "";

                // 3. Update the Player in your main database
                await Player.findByIdAndUpdate(p._id, { 
                    teamName: teamName,
                    teamLogo: teamLogo 
                });
                count++;
            }
        }
        res.json({ success: true, message: `Successfully synchronized ${count} players with their Official Clubs and Logos!` });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});
// 2. Captain Login Route
// --- CAPTAIN LOGIN (USING AUCTION DB CREDENTIALS) ---
// --- GET ALL TEAMS FOR LOGIN DROPDOWN ---
// 1. TEST ROUTE: Open this in your browser to see if it works: 
// https://nexus-acl-backend.onrender.com/test
app.get('/', (req, res) => res.send("PES PARK Server is LIVE 🚀"));
app.get('/test', (req, res) => res.json({ status: "Working", message: "API is reachable" }));

// 2. THE TEAM LIST ROUTE (The one causing the 404)
app.get('/api/teams/all', async (req, res) => {
    try {
        const teams = await mongoose.model('Team').find({}, 'name logo');
        console.log("Teams fetched for login:", teams.length);
        res.json(teams);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- ADD THIS TO COMMUNITY BACKEND server.js ---
app.get('/api/teams/profile/:name', async (req, res) => {
    try {
        const teamName = req.params.name;
        // Access shared collections
        const P = mongoose.connection.db.collection('players');
        const T = mongoose.connection.db.collection('teams');

        const team = await T.findOne({ name: teamName });
        const players = await Player.find({ 
    teamName: { $regex: new RegExp('^' + teamName + '$', 'i') } 
});
        if (!team) return res.status(404).json({ error: "Team not found" });
        res.json({ team, players });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});
const MistralClient = require('@mistralai/mistralai').default;
const mistral = new MistralClient(process.env.MISTRAL_API_KEY);

app.post('/api/bot/groq-query', async (req, res) => { // Kept name same so frontend doesn't break
    try {
        const { message } = req.body;

        // 1. Fetch Real-time Database state
        const players = await Player.find({}, 'name marketValue bdrPoints teamName');
        
        // 2. Create a high-density data string for Mistral
        const dbContext = players.map(p => 
            `${p.name}(MV:${p.marketValue}M,BDR:${p.bdrPoints},Team:${p.teamName || 'Free Agent'})`
        ).join(' | ');

        // 3. Mistral Chat Completion
        const chatResponse = await mistral.chat({
            model: 'mistral-tiny', // 'tiny' is the fastest for chat support
            messages: [
                {
                    role: 'system',
                    content: `You are the Nexus Legends eSports Support Bot. 
                    DATABASE_ARCHIVE: ${dbContext}. 
                    INSTRUCTIONS: Use the archive to answer stats questions. Be elite, professional, and concise. 
                    If data isn't in the archive, say it's not in the Nexus records.`
                },
                { role: 'user', content: message }
            ],
            config: { safeMode: true }
        });

        res.json({ reply: chatResponse.choices[0].message.content });
    } catch (err) {
        console.error("Mistral Error:", err);
        res.status(500).json({ reply: "NEURAL LINK FAILURE: System reboot required." });
    }
});
// --- NEW: SMART TROPHY AWARD ROUTE ---
app.post('/api/hof/award-smart-trophy', async (req, res) => {
    try {
        const { seasonName, trophyType, playerName } = req.body;

        // 1. Increment the count in the Player's profile automatically
        // trophyType matches the schema: ballonDor, ucl, league, weekly, goldenBoot
        const updateField = `trophies.${trophyType}`;
        await Player.findOneAndUpdate(
            { name: playerName },
            { $inc: { [updateField]: 1 } }
        );

        // 2. Add this specific award to the HOF Season record
        await HofSeason.findOneAndUpdate(
            { seasonName: seasonName },
            { $push: { trophyWinners: { title: trophyType.toUpperCase(), winner: playerName } } },
            { upsert: true }
        );

        res.json({ success: true, message: `Awarded ${trophyType} to ${playerName}!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- server.js for pes-park-backend ---
const axios = require('axios');

app.post('/api/captain/login', async (req, res) => {
    try {
        // Forwarding to the Auction backend bridge we just created
        const auctionRes = await axios.post('https://nexus-acl-backend.onrender.com/api/sync/verify-captain', req.body);
        
        // Return the full data pack (purse, squad, etc.) to the website
        res.json(auctionRes.data);
    } catch (err) {
        if (err.response) {
            // This catches the "Mismatch" or "Wrong Pass" from Auction server
            return res.status(err.response.status).json(err.response.data);
        }
        res.status(500).json({ success: false, message: "Auction Server is Offline" });
    }
});
// --- 1. LIST PLAYER (NO MONEY TOUCHED HERE) ---
app.post('/api/market/list-player', async (req, res) => {
    const { playerName, fromTeam, releaseFee, addons, targetTeam } = req.body;

    try {
        // We simply create the listing. We do NOT deduct money from 'fromTeam' yet.
        const newListing = await TransferListing.create({
            playerName, 
            fromTeam, 
            releaseFee: Number(releaseFee), 
            addons, 
            targetTeam: targetTeam || "General"
        });

        // Notify via Email if it's a private offer
        if (targetTeam && targetTeam !== "General") {
            try {
                const AuctionUsers = mongoose.connection.db.collection('users');
                const targetCaptain = await AuctionUsers.findOne({ name: targetTeam, role: 'captain' });

                if (targetCaptain && targetCaptain.email) {
                    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
                    sendSmtpEmail.subject = `🚨 PRIVATE TRANSFER OFFER: ${playerName}`;
                    sendSmtpEmail.htmlContent = `
                        <div style="font-family:sans-serif; background:#0f172a; color:white; padding:20px; border:2px solid #10b981; border-radius:15px;">
                            <h2>New Transfer Offer!</h2>
                            <p><b>${fromTeam}</b> has offered you <b>${playerName}</b> for <b>${releaseFee}M</b>.</p>
                            <p>Terms: ${addons || 'None'}</p>
                            <a href="https://pes-park-official.vercel.app/captain-login.html" style="color:#10b981; font-weight:bold;">Login to Dressing Room to Accept</a>
                        </div>`;
                    sendSmtpEmail.sender = { "name": "NEXUS MARKET", "email": process.env.BREVO_SENDER_EMAIL };
                    sendSmtpEmail.to = [{ "email": targetCaptain.email }];
                    await apiInstance.sendTransacEmail(sendSmtpEmail);
                }
            } catch (e) { console.log("Email notify failed, but listing created."); }
        }

        res.json({ success: true, message: "Listing published! Money will transfer upon acceptance." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 2. ACCEPT OFFER (THE ONLY PLACE MONEY MOVES) ---
app.post('/api/market/accept-offer', async (req, res) => {
    const { listingId, buyerTeamName } = req.body;

    try {
        const listing = await TransferListing.findById(listingId);
        if (!listing) return res.status(404).json({ error: "Offer expired or already accepted." });

        const fee = Number(listing.releaseFee);
        const sellerTeamName = listing.fromTeam;
        const playerName = listing.playerName;

        const AuctionTeams = mongoose.connection.db.collection('teams');
        const AuctionPlayers = mongoose.connection.db.collection('players');

        // 1. Check if Buyer has enough money
        const buyerTeam = await AuctionTeams.findOne({ name: buyerTeamName });
        if (!buyerTeam || buyerTeam.budget < fee) {
            return res.status(400).json({ error: `Insufficient Purse! You need ${fee}M but only have ${buyerTeam?.budget || 0}M.` });
        }

        // --- THE ACTUAL TRANSACTION ---
        
        // 2. DEBIT Buyer
        await AuctionTeams.updateOne({ name: buyerTeamName }, { $inc: { budget: -fee } });
        
        // 3. CREDIT Seller
        await AuctionTeams.updateOne({ name: sellerTeamName }, { $inc: { budget: fee } });

        // 4. Update Ownership in Auction DB
        // Format: "TeamName (PriceM)"
        await AuctionPlayers.updateOne(
            { name: { $regex: new RegExp("^" + playerName + "$", "i") } },
            { $set: { soldTo: `${buyerTeamName} (${fee}M)` } }
        );

        // 5. Update Player in Community DB
        await Player.findOneAndUpdate(
            { name: playerName },
            { teamName: buyerTeamName, marketValue: fee }
        );

        // 6. Remove listing from market
        await TransferListing.findByIdAndDelete(listingId);

        res.json({ success: true, message: `Successfully signed ${playerName}! ${fee}M transferred.` });

    } catch (err) {
        console.error("Transfer Error:", err);
        res.status(500).json({ error: "Internal Server Error during transfer." });
    }
});
// --- 1. GET PLAYERS OF A SPECIFIC TEAM (To populate trade dropdown) ---
app.get('/api/teams/players/:teamName', async (req, res) => {
    try {
        const P = mongoose.connection.db.collection('players');
        const players = await P.find({ 
            soldTo: { $regex: new RegExp('^' + req.params.teamName, 'i') } 
        }).toArray();
        res.json(players);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// --- UPTIMEROBOT ISOLATED LOGIC ---
app.get('/api/external/uptime-audit', async (req, res) => {
    try {
        const result = await axios.post('https://api.uptimerobot.com/v2/getMonitors', {
            api_key: "m803744301-74abc209f3add2b5e0ba9c33", // Isolated key
            format: "json",
            custom_uptime_ratios: "1-7-30",
            response_times: 1
        });
        
        const m = result.data.monitors[0];
        res.json({
            status: m.status === 2 ? "OPERATIONAL" : "DISRUPTED",
            ratios: m.custom_uptime_ratio.split("-"),
            avgPing: m.average_response_time,
            lastCheck: new Date().toLocaleTimeString()
        });
    } catch (err) {
        res.status(500).json({ error: "Audit Sync Failed" });
    }
});
// --- 2. LIST A TRADE OFFER ---
// We update the listing schema logic to include trade details
app.post('/api/market/list-trade', async (req, res) => {
    const { fromTeam, myPlayer, targetTeam, targetPlayer, cashOffer, addons, isPublic } = req.body;
    try {
        const listing = await TransferListing.create({
            playerName: myPlayer, // The player I am giving
            fromTeam: fromTeam,
            targetTeam: isPublic ? "General" : targetTeam,
            tradePlayerWanted: targetPlayer, // The player I want in return
            releaseFee: Number(cashOffer) || 0, // Extra cash I am paying
            addons: addons,
            type: "TRADE"
        });

        // EMAIL LOGIC (Same as transfer listing)
        if (!isPublic && targetTeam !== "General") {
            try {
                const AuctionUsers = mongoose.connection.db.collection('users');
                const targetCaptain = await AuctionUsers.findOne({ name: targetTeam, role: 'captain' });

                if (targetCaptain && targetCaptain.email) {
                    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
                    sendSmtpEmail.subject = `🚨 PRIVATE TRADE OFFER: ${playerName}`;
                    sendSmtpEmail.htmlContent = `
                        <div style="font-family:sans-serif; background:#0f172a; color:white; padding:20px; border:2px solid #10b981; border-radius:15px;">
                            <h2>New Trade Offer!</h2>
                            <p><b>${fromTeam}</b> has offered you <b>${playerName}</b> For <b>${tradePlayerWanted}</b>.</p>
                            <p>EXTRA CASH: ${addons || 'None'}M</p>
                            <a href="https://pes-park-official.vercel.app/captain-login.html" style="color:#10b981; font-weight:bold;">Login to Dressing Room to Accept</a>
                        </div>`;
                    sendSmtpEmail.sender = { "name": "NEXUS MARKET", "email": process.env.BREVO_SENDER_EMAIL };
                    sendSmtpEmail.to = [{ "email": targetCaptain.email }];
                    await apiInstance.sendTransacEmail(sendSmtpEmail);
                }
            } catch (e) { console.log("Email notify failed, but listing created."); }
            // ... (Use existing Brevo logic to notify targetTeam Captain about a Trade Proposal)
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. ACCEPT TRADE (SWAP LOGIC) ---
app.post('/api/market/accept-trade', async (req, res) => {
    const { listingId, acceptorTeam } = req.body;
    try {
        const listing = await TransferListing.findById(listingId);
        if (!listing) return res.status(404).json({ error: "Offer expired." });

        const cash = Number(listing.releaseFee);
        const playerA = listing.playerName; // From Proposer
        const playerB = listing.tradePlayerWanted; // From Acceptor
        const teamA = listing.fromTeam; // Proposer
        const teamB = acceptorTeam; // Acceptor

        const T = mongoose.connection.db.collection('teams');
        const P = mongoose.connection.db.collection('players');

        // Check if Proposer (Team A) has the cash he offered
        const proposer = await T.findOne({ name: teamA });
        if (proposer.budget < cash) return res.status(400).json({ error: "Proposer no longer has the funds." });

        // --- THE SWAP TRANSACTION ---
        // 1. Move Cash (Team A pays Team B)
        await T.updateOne({ name: teamA }, { $inc: { budget: -cash } });
        await T.updateOne({ name: teamB }, { $inc: { budget: cash } });

        // 2. Swap Player A -> Team B
        await P.updateOne({ name: playerA }, { $set: { soldTo: `${teamB} (TRADE)` } });
        await Player.findOneAndUpdate({ name: playerA }, { teamName: teamB });

        // 3. Swap Player B -> Team A
        await P.updateOne({ name: playerB }, { $set: { soldTo: `${teamA} (TRADE)` } });
        await Player.findOneAndUpdate({ name: playerB }, { teamName: teamA });

        await TransferListing.findByIdAndDelete(listingId);
        res.json({ success: true, message: "Swap Complete!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// 3. Get Transfer Market News (Latest 10 Sold Players)
app.get('/api/market/news', async (req, res) => {
    const news = await Fixture.find({ status: "Completed" }).sort({ createdAt: -1 }).limit(5);
    const trending = await Player.find().sort({ marketValue: -1 }).limit(5);
    res.json({ news, trending });
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
    try {
        const playerData = req.body;

        // NEW: Auto-assign logo if a team is selected
        if (playerData.teamName && playerData.teamName !== "") {
            const team = await Team.findOne({ name: playerData.teamName });
            if (team) {
                playerData.teamLogo = team.logo; // Copies logo from Team collection
            }
        }

        const newPlayer = new Player(playerData);
        await newPlayer.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/players/:id', async (req, res) => {
    await Player.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// --- DYNAMIC GLOBAL STATS ROUTE ---
app.get('/api/stats', async (req, res) => {
    try {
        // 1. Find player with highest BDR Points
        const topBDR = await Player.findOne().sort({ bdrPoints: -1 });

        // 2. Find player with highest Market Value
        const topMV = await Player.findOne().sort({ marketValue: -1 });

        // 3. Count total number of teams registered
        const teamTotal = await Team.countDocuments();

        // 4. Count total players
        const playerTotal = await Player.countDocuments();

        res.json({
            bdrValue: topBDR ? topBDR.bdrPoints : 0,
            bdrName: topBDR ? topBDR.name : "None",
            mvValue: topMV ? topMV.marketValue : 0,
            mvName: topMV ? topMV.name : "None",
            teamsCount: teamTotal,
            playersCount: playerTotal
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/stats', async (req, res) => {
    await Stats.findOneAndUpdate({}, req.body);
    res.json({ success: true });
});
// --- IMPORT TEAM NAME AND LOGO FROM AUCTION SITE ---
app.get('/api/danger/import-team-data', async (req, res) => {
    try {
        const pesPlayers = await Player.find();
        const AuctionPlayers = mongoose.connection.db.collection('players');
        const AuctionTeams = mongoose.connection.db.collection('teams');
        let count = 0;

        for (let p of pesPlayers) {
            const aPlayer = await AuctionPlayers.findOne({ name: { $regex: new RegExp("^" + p.name + "$", "i") } });

            if (aPlayer && aPlayer.soldTo && aPlayer.soldTo !== '-' && aPlayer.soldTo !== 'UNSOLD') {
                // 1. Extract Team Name (e.g., "PSG (50M)" -> "PSG")
                const teamName = aPlayer.soldTo.split(' (')[0].trim();
                
                // 2. Fetch Logo for this team from the auction 'teams' collection
                const teamInfo = await AuctionTeams.findOne({ name: teamName });
                const teamLogo = teamInfo ? teamInfo.logoUrl : "";

                await Player.findByIdAndUpdate(p._id, { 
                    teamName: teamName,
                    teamLogo: teamLogo 
                });
                count++;
            }
        }
        res.json({ success: true, message: `Imported Team data for ${count} players!` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ALLOW PLAYERS TO UPDATE SQUAD IMAGE SELF ---
app.put('/api/players/:id/self-update-squad', async (req, res) => {
    try {
        const { squadImage } = req.body;
        await Player.findByIdAndUpdate(req.params.id, { squadImage });
        res.json({ success: true, message: "Squad Updated!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// --- FETCH FULL TEAM PROFILE DATA ---
app.get('/api/teams/profile/:name', async (req, res) => {
    try {
        const teamName = req.params.name;

        // 1. Get Team Basic Info
        const team = await Team.findOne({ name: teamName });

        // 2. Get all Players assigned to this team
        const players = await Player.find({ teamName: teamName });

        // 3. Get Last 5 Matches (Fixtures)
        const matches = await Fixture.find({
            $or: [{ playerA: teamName }, { playerB: teamName }],
            status: "Completed"
        }).sort({ createdAt: -1 }).limit(5);

        // 4. Get Trophies from Hall of Fame
        const hof = await HofSeason.find({ "trophyWinners.winner": teamName });
        const trophies = [];
        hof.forEach(season => {
            season.trophyWinners.forEach(t => {
                if(t.winner === teamName) trophies.push({ season: season.seasonName, title: t.title });
            });
        });

        res.json({ team, players, matches, trophies });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- FIXED CAPTAIN LOGIN FOR AUCTION SYNC ---
app.post('/api/captain/login', async (req, res) => {
    try {
        // We receive email, password, and the team name selected from dropdown
        const { email, password, selectedTeam } = req.body;

        if (!email || !password || !selectedTeam) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        // 1. Find the user where email matches AND role is 'captain'
        const user = await User.findOne({ 
            email: email.trim().toLowerCase(), 
            role: 'captain' 
        });

        if (!user) {
            return res.status(401).json({ success: false, message: "Email not found or not a Captain" });
        }

        // 2. CHECK TEAM MATCH: 
        // In your auction site, 'Team Name' is saved in the 'name' field of the User collection.
        if (user.name !== selectedTeam) {
            return res.status(401).json({ success: false, message: "This email is not linked to " + selectedTeam });
        }

        // 3. VERIFY PASSWORD: Uses bcrypt to compare with the 'Set Password' from auction site
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Incorrect password" });
        }

        // 4. FETCH TEAM DATA: Get the budget/purse from the Team collection
        const teamName = selectedTeam; // e.g., "PSG"

const squad = await mongoose.connection.db.collection('players').find({ 
    soldTo: { $regex: new RegExp('^' + teamName + ' \\(') } 
}).toArray();

// Also, ensure we fetch the LATEST logo from the teams collection
const teamStats = await mongoose.connection.db.collection('teams').findOne({ name: teamName });
        res.json({ 
    success: true, 
    teamName: teamName,
    purse: teamStats ? teamStats.budget : 0,
    logo: teamStats ? teamStats.logoUrl : "", // Fresh logo from DB
    squad: squad 
});

    } catch (err) {
        console.error("Login Crash:", err);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});// --- ADD TO TOP OF server.js ---
const transferSchema = new mongoose.Schema({
    playerName: String,
    fromTeam: String,
    targetTeam: { type: String, default: "General" },
    releaseFee: Number,
    addons: String,
    timestamp: { type: Date, default: Date.now }
});
const TransferListing = mongoose.models.TransferListing || mongoose.model('TransferListing', transferSchema);

app.post('/api/market/list-player', async (req, res) => {
    const { playerName, fromTeam, releaseFee, addons, targetTeam } = req.body;

    try {
        // 1. DEDUCT FEE: Use the shared database connection to update the Auction 'teams' collection
        const AuctionTeams = mongoose.connection.db.collection('teams');
        await AuctionTeams.updateOne(
            { name: fromTeam },
            { $inc: { budget: -Number(releaseFee) } }
        );

        // 2. SAVE LISTING: Store the offer in the Community DB
        const newListing = await TransferListing.create({
            playerName, fromTeam, releaseFee, addons, targetTeam
        });

        // 3. PRIVATE EMAIL LOGIC: If a specific team is targeted, notify their captain
        if (targetTeam && targetTeam !== "General") {
            const AuctionUsers = mongoose.connection.db.collection('users');
            const targetCaptain = await AuctionUsers.findOne({ name: targetTeam, role: 'captain' });

            if (targetCaptain && targetCaptain.email) {
                // Prepare Brevo Email
                const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
                sendSmtpEmail.subject = `🚨 TRANSFER OFFER: ${playerName}`;
                sendSmtpEmail.htmlContent = `
                    <div style="font-family: sans-serif; background:#0f172a; color:white; padding:30px; border-radius:20px; border:2px solid #10b981;">
                        <h2 style="color:#10b981; margin-top:0;">New Private Offer!</h2>
                        <p>Captain of <b>${fromTeam}</b> has sent you a direct offer.</p>
                        <hr style="border:0; border-top:1px solid #1e293b; margin:20px 0;">
                        <p style="font-size:18px;">Player: <b>${playerName}</b></p>
                        <p style="font-size:18px;">Release Fee: <span style="color:#10b981;">${releaseFee}M</span></p>
                        <p style="color:#94a3b8;">Terms: ${addons || 'N/A'}</p>
                        <br>
                        <a href="https://pes-park-official.vercel.app/captain-login.html" 
                           style="display:inline-block; background:#10b981; color:black; padding:12px 25px; border-radius:10px; text-decoration:none; font-weight:bold;">
                           Log in to Accept
                        </a>
                    </div>`;
                sendSmtpEmail.sender = { "name": "NEXUS LEGENDS MARKET", "email": process.env.BREVO_SENDER_EMAIL };
                sendSmtpEmail.to = [{ "email": targetCaptain.email }];
                
                await apiInstance.sendTransacEmail(sendSmtpEmail);
                console.log(`Email sent to captain of ${targetTeam}`);
            }
        }

        res.json({ success: true, message: "Listing published and email sent!" });

    } catch (err) {
        console.error("Publish Error:", err);
        res.status(500).json({ error: "Failed to publish listing." });
    }
});

// 2. HELPER: Send Transfer Email
async function sendTransferAlert(toEmail, subject, html) {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.sender = { "name": "PES PARK MARKET", "email": process.env.BREVO_SENDER_EMAIL };
    sendSmtpEmail.to = [{ "email": toEmail }];
    return apiInstance.sendTransacEmail(sendSmtpEmail);
}

// 3. ROUTE: List Player for Transfer
app.post('/api/market/list-player', async (req, res) => {
    const { playerName, fromTeam, releaseFee, addons, targetTeam } = req.body;

    try {
        // A. Deduct Fee from Team Purse
        const team = await Team.findOneAndUpdate(
            { name: fromTeam },
            { $inc: { budget: -Number(releaseFee) } },
            { new: true }
        );

        // B. Save to Transfer Listings
        const listing = await TransferListing.create({
            playerName, fromTeam, releaseFee, addons, targetTeam
        });

        // C. Notify Target Team via Email (If applicable)
        if (targetTeam !== "General") {
            const targetCaptain = await User.findOne({ name: targetTeam, role: 'captain' });
            if (targetCaptain) {
                await sendTransferAlert(
                    targetCaptain.email, 
                    `🚨 PRIVATE OFFER: ${playerName}`,
                    `<h1>Transfer Offer</h1><p>${fromTeam} has offered you <b>${playerName}</b>.</p><p>Fee: ${releaseFee}M</p><p>Addons: ${addons}</p>`
                );
            }
        }

        res.json({ success: true, newBudget: team.budget });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. ROUTE: Get All Active Listings (For transfer.html)
app.get('/api/market/listings', async (req, res) => {
    const data = await TransferListing.find().sort({ timestamp: -1 });
    res.json(data);
});


// Add these to your existing server.js

const ADMIN_EMAIL = "admin@nexus.com";
const ADMIN_PASS = "admin@nexus123"; // You should use environment variables for this!

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

// --- SMART FIXTURE MODEL ---
const fixtureSchema = new mongoose.Schema({
    tourId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
    playerA: String,
    playerB: String,
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 },
    status: { type: String, default: "Upcoming" },
    stage: { type: String, default: "League" },
    isSubFixture: { type: Boolean, default: false }, // Must be Boolean
    parentFixtureId: { type: String, default: null }, // ID of the Team Match
    createdAt: { type: Date, default: Date.now }
});

// This line creates the "Fixture" variable that the error is complaining about
const Fixture = mongoose.models.Fixture || mongoose.model('Fixture', fixtureSchema);
const AuctionFixture = mongoose.model('AuctionFixture', fixtureSchema);

// --- ADD THESE TOO IF YOU USE SOLO/QUICK/WEEKEND TOURS ---
const SoloFixture = mongoose.model('SoloFixture', fixtureSchema);
const QuickFixture = mongoose.model('QuickFixture', fixtureSchema);
const WeekendFixture = mongoose.model('WeekendFixture', fixtureSchema);
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
// --- UPDATE THIS ROUTE IN server.js ---
app.get('/api/danger/import-auction-mv', async (req, res) => {
    try {
        const pesPlayers = await Player.find();
        const AuctionCollection = mongoose.connection.db.collection('players');
        let count = 0;

        for (let p of pesPlayers) {
            const auctionPlayer = await AuctionCollection.findOne({ 
                name: { $regex: new RegExp("^" + p.name + "$", "i") } 
            });

            if (auctionPlayer && auctionPlayer.soldTo && auctionPlayer.soldTo !== '-') {
                // Extract "50" from "PSG (50M)"
                const priceMatch = auctionPlayer.soldTo.match(/\((\d+)M\)/);
                const finalPrice = priceMatch ? parseInt(priceMatch[1]) : 0;

                if (finalPrice > 0) {
                    // FIX: Set BOTH Auction Price (Fixed) and Market Value (Starting Point)
                    await Player.findByIdAndUpdate(p._id, { 
                        auctionPrice: finalPrice, 
                        marketValue: finalPrice 
                    });
                    count++;
                }
            }
        }
        res.json({ success: true, message: `Synced Auction Price & MV for ${count} players!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 1. Team Schema
const TeamSchema = new mongoose.Schema({
    name: String,
    logo: String,
    members: [String],
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 }
});
const Team = mongoose.model('Team', TeamSchema);

// --- DYNAMIC LEAGUE LEADER ROUTE ---
app.get('/api/teams/leader', async (req, res) => {
    try {
        // 1. Find the most recent Auction Tournament created
        const latestTour = await Tournament.findOne({ type: 'auction' }).sort({ createdAt: -1 });

        if (!latestTour) {
            return res.json({ name: "None", points: 0 });
        }

        // 2. Fetch the standings for this specific tournament
        const standings = await Standing.find({ tourId: latestTour._id });

        if (standings.length === 0) {
            return res.json({ name: "None", points: 0 });
        }

        // 3. Sort by Points > GD > GF (Just like your points table)
        standings.sort((a, b) => {
            const gdA = (a.gf || 0) - (a.ga || 0);
            const gdB = (b.gf || 0) - (b.ga || 0);
            return (b.points - a.points) || (gdB - gdA) || (b.gf - a.gf);
        });

        // 4. Return the #1 team
        const leader = standings[0];
        res.json({
            name: leader.participant,
            points: leader.points
        });
    } catch (err) {
        console.error("Leader Error:", err);
        res.status(500).json({ error: "Failed to fetch leader" });
    }
});

// 3. Route to update team results (Used by Dashboard)
app.put('/api/teams/update-stats', async (req, res) => {
    const { name, wins, draws, losses } = req.body;
    await Team.findOneAndUpdate({ name }, { wins, draws, losses }, { upsert: true });
    res.json({ success: true });
});
app.get('/api/teams/all', async (req, res) => {
    try {
        // Fetch name, logo, and logoUrl (to support both naming styles from your auction site)
        const teams = await mongoose.model('Team').find({}, 'name logo logoUrl');
        
        // Transform the data so the frontend always sees a field called "logo"
        const formattedTeams = teams.map(t => ({
            _id: t._id,
            name: t.name,
            logo: t.logo || t.logoUrl || 'https://via.placeholder.com/40'
        }));

        console.log("Teams synced from Auction DB:", formattedTeams.length);
        res.json(formattedTeams);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
    gf: { type: Number, default: 0 }, // Goals For
    ga: { type: Number, default: 0 }, // Goals Against
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

// --- FIXED STANDINGS ROUTE ---
app.get('/api/smart/standings/:tourId', async (req, res) => {
    try {
        const { tourId } = req.params;

        // Validation: If ID is "undefined" or not a valid MongoDB ID, return empty array
        if (!mongoose.Types.ObjectId.isValid(tourId)) {
            return res.json([]); 
        }

        const data = await Standing.find({ tourId: tourId });
        res.json(data);
    } catch (err) {
        console.error("Standings DB Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
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
// Check this route in your server.js
// 1. Route to CREATE a fixture (Used by Dashboard)
app.post('/api/smart/create-fixture', async (req, res) => {
    try {
        const { tourId, playerA, playerB, isSubFixture, parentFixtureId, stage } = req.body;
        
        const newFixture = new Fixture({
            tourId,
            playerA,
            playerB,
            isSubFixture: isSubFixture || false,
            parentFixtureId: parentFixtureId || null,
            stage: stage || "League",
            status: "Upcoming"
        });

        await newFixture.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Route to FETCH fixtures (Used by Index.html)
app.get('/api/smart/fixtures/:tourId', async (req, res) => {
    try {
        const { tourId } = req.params;
        // If tourId is just a placeholder string, return empty array instead of error
        if (tourId.length < 20) return res.json([]); 

        const matches = await Fixture.find({ tourId: tourId }).sort({ createdAt: -1 });
        res.json(matches);
    } catch (err) {
        res.status(500).json({ error: "DB Error" });
    }
});
// 1. THE UPDATED REWARDS ENGINE
const applyRewards = async (pName, myScore, oppScore, tourType, tourId, isSubFixture, oppName) => {
    if (!pName) return;
    if (tourType === 'quick') {
        console.log(`Quick Tour Match Detected: Skipping Global Stat Updates for ${pName}`);
        return; 
    }

    // Fix: Handle cases where isSubFixture might come as a string "true"
    const subFlag = String(isSubFixture) === "true";

    // 1. Find the Player in the database
    const player = await Player.findOne({ name: { $regex: new RegExp('^' + pName.trim() + '$', 'i') } });
    
    // 2. LOGIC: Update Individual Stats if it's a Solo Challenge OR a Sub-Match (Member vs Member)
    if (player && (tourType === 'solo' || subFlag === true)) {
        let mvAdd = (myScore > oppScore) ? 15 : (myScore === oppScore ? 5 : -10);
        let bdrAdd = (myScore > oppScore) ? 5 : (myScore === oppScore ? 1 : -3);
        
        // Goal Bonus
        mvAdd += (Number(myScore) * 3);
        bdrAdd += (Number(myScore) * 1);

        // Update Global Stats & Match History
        const matchEntry = {
            opponentName: oppName,
            myScore: Number(myScore),
            oppScore: Number(oppScore),
            result: (myScore > oppScore) ? "WIN" : (myScore === oppScore ? "DRAW" : "LOSS"),
            date: new Date()
        };

        await Player.findByIdAndUpdate(player._id, { 
            $inc: { marketValue: mvAdd, bdrPoints: bdrAdd },
            $push: { matches: { $each: [matchEntry], $position: 0 } } 
        });
        
        console.log(`Individual rewards applied to ${pName} (${subFlag ? 'Sub-Match' : 'Solo'})`);
    }

    // 3. LOGIC: Update Point Table (Standing) if it's NOT a sub-fixture 
    // (Main team matches update the table; individual sub-matches do not)
    if (subFlag === false) {
        const pts = (myScore > oppScore) ? 3 : (myScore === oppScore ? 1 : 0);
        await Standing.findOneAndUpdate(
            { tourId: tourId, participant: pName },
            { $inc: { 
                played: 1, 
                wins: myScore > oppScore ? 1 : 0, 
                draws: myScore === oppScore ? 1 : 0, 
                losses: myScore < oppScore ? 1 : 0, 
                gf: Number(myScore), ga: Number(oppScore), points: pts 
            }}
        );
    }
};

// 2. THE UPDATED SCORE UPDATE ROUTE
app.put('/api/smart/update-score/:id', async (req, res) => {
    try {
        const { scoreA, scoreB, stage } = req.body;
        const fixture = await Fixture.findById(req.params.id);

        if (!fixture) return res.status(404).json({ error: "Fixture not found" });
        if (stage) fixture.stage = stage;

        // --- CRITICAL FIX: PREVENT DOUBLE COUNTING ---
        // If the match was already completed, do NOT run applyRewards again.
        if (fixture.status === "Completed") {
            return res.status(400).json({ error: "This match is already recorded. To change the score, delete and recreate it." });
        }

        const tour = await Tournament.findById(fixture.tourId);
        const tourType = tour ? tour.type : "auction";

        fixture.scoreA = Number(scoreA);
        fixture.scoreB = Number(scoreB);
        fixture.status = "Completed"; // Lock the match
        await fixture.save();

        // Process rewards
        await applyRewards(fixture.playerA, scoreA, scoreB, tourType, fixture.tourId, fixture.isSubFixture, fixture.playerB);
        await applyRewards(fixture.playerB, scoreB, scoreA, tourType, fixture.tourId, fixture.isSubFixture, fixture.playerA);

        res.json({ success: true, message: "Score Locked & Stats Updated!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- SYNC GOLDEN BOOT WITH ENTIRE MATCH HISTORY ---
app.get('/api/smart/sync-all-goals', async (req, res) => {
    try {
        // 1. Reset all Golden Boot records to 0 first
        await TourRank.deleteMany({ category: "boot" });

        // 2. Get all matches that have scores
        const completedMatches = await Fixture.find({ status: "Completed" });

        for (const match of completedMatches) {
            // Get the tour type (auction/solo/etc)
            const tour = await Tournament.findById(match.tourId);
            const type = tour ? tour.type : "auction";

            const updateGoals = async (pName, goals) => {
                if (!pName || goals <= 0) return;
                const pData = await Player.findOne({ name: pName });
                await TourRank.findOneAndUpdate(
                    { tour: type, category: "boot", playerName: pName },
                    { 
                        $inc: { totalValue: goals },
                        $set: { teamName: pData ? pData.teamName : "Free Agent" }
                    },
                    { upsert: true }
                );
            };

            await updateGoals(match.playerA, match.scoreA);
            await updateGoals(match.playerB, match.scoreB);
        }

        res.json({ success: true, message: "Golden Boot synced with history!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/smart/recalculate-table/:tourId', async (req, res) => {
    try {
        const { tourId } = req.params;

        // 1. Get Tournament to find the official list of participants (Clubs or Players)
        const tour = await Tournament.findById(tourId);
        if (!tour) return res.status(404).json({ error: "Tour not found" });

        // 2. WIPE the current corrupted standings for this tour
        await Standing.deleteMany({ tourId });

        // 3. INITIALIZE every participant to 0
        const initialStandings = tour.participants.map(p => ({
            tourId, participant: p, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0
        }));
        await Standing.insertMany(initialStandings);

        // 4. FETCH all completed matches for this tour
        const matches = await Fixture.find({ tourId, status: "Completed" });

        for (let m of matches) {
            // --- CRITICAL FIX: IGNORE MEMBER MATCHES ---
            // Member matches update individual profiles, NOT the points table.
            if (m.isSubFixture === true || String(m.isSubFixture) === "true") {
                continue; // Skip this loop iteration
            }

            const updateStats = async (name, myS, oppS) => {
                let w = myS > oppS ? 1 : 0;
                let d = myS === oppS ? 1 : 0;
                let l = myS < oppS ? 1 : 0;
                let pts = (myS > oppS) ? 3 : (myS === oppS ? 1 : 0);

                await Standing.findOneAndUpdate(
                    { tourId, participant: name },
                    { $inc: { played: 1, wins: w, draws: d, losses: l, gf: myS, ga: oppS, points: pts } }
                );
            };

            // Update both teams in the table
            await updateStats(m.playerA, m.scoreA, m.scoreB);
            await updateStats(m.playerB, m.scoreB, m.scoreA);
        }

        res.json({ success: true, message: "Table rebuilt! Corrupted data removed." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
// --- FIXED SYNC ALL REWARDS ROUTE ---
app.get('/api/smart/sync-all-rewards', async (req, res) => {
    try {
        await Player.updateMany({}, { $set: { bdrPoints: 0, marketValue: 0 } });
        await TourRank.deleteMany({});
        await Standing.updateMany({}, { $set: { played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 } });

        const matches = await Fixture.find({ status: "Completed" });

        for (let m of matches) {
            const tour = await Tournament.findById(m.tourId);
            const tType = tour ? tour.type : "auction";

            const calc = (pName, s1, s2) => {
                let b = (s1 > s2 ? 5 : (s1 === s2 ? 1 : -3)) + (s1 * 1);
                let v = (s1 > s2 ? 15 : (s1 === s2 ? 0 : -10)) + (s1 * 3);
                let r = (s1 > s2 ? 3 : (s1 === s2 ? 1 : 0));
                let p = (s1 > s2 ? 3 : (s1 === s2 ? 1 : 0));
                return { b, v, r, p };
            };

            const resA = calc(m.playerA, m.scoreA, m.scoreB);
            const resB = calc(m.playerB, m.scoreB, m.scoreA);

            // FIX: Removed the extra ");" after resA.b
            await Player.findOneAndUpdate({ name: m.playerA }, { $inc: { bdrPoints: resA.b, marketValue: resA.v } });
            
            await TourRank.findOneAndUpdate({ tour: tType, category: "best", playerName: m.playerA }, { $inc: { totalValue: resA.r } }, { upsert: true });
            await TourRank.findOneAndUpdate({ tour: tType, category: "boot", playerName: m.playerA }, { $inc: { totalValue: m.scoreA } }, { upsert: true });
            await Standing.findOneAndUpdate({ tourId: m.tourId, participant: m.playerA }, { $inc: { played: 1, wins: m.scoreA > m.scoreB ? 1 : 0, draws: m.scoreA === m.scoreB ? 1 : 0, losses: m.scoreA < m.scoreB ? 1 : 0, gf: m.scoreA, ga: m.scoreB, points: resA.p } });

            // Update DB for Player B
            await Player.findOneAndUpdate({ name: m.playerB }, { $inc: { bdrPoints: resB.b, marketValue: resB.v } });
            
            await TourRank.findOneAndUpdate({ tour: tType, category: "best", playerName: m.playerB }, { $inc: { totalValue: resB.r } }, { upsert: true });
            await TourRank.findOneAndUpdate({ tour: tType, category: "boot", playerName: m.playerB }, { $inc: { totalValue: m.scoreB } }, { upsert: true });
            await Standing.findOneAndUpdate({ tourId: m.tourId, participant: m.playerB }, { $inc: { played: 1, wins: m.scoreB > m.scoreA ? 1 : 0, draws: m.scoreA === m.scoreB ? 1 : 0, losses: m.scoreB < m.scoreA ? 1 : 0, gf: m.scoreB, ga: m.scoreA, points: resB.p } });
        }
        res.json({ success: true, message: "All rewards recalculated from history!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// --- server.js ---
// --- UPDATED HOF SCHEMA ---
const HofSeasonSchema = new mongoose.Schema({
    seasonName: { type: String, required: true, unique: true },
    specialHighlights: [{ 
        label: String, 
        value: String 
    }],
    trophyWinners: [{ 
        title: String, 
        winner: String, 
        runner: String 
    }],
    timestamp: { type: Date, default: Date.now }
});
const HofSeason = mongoose.model('HofSeason', HofSeasonSchema);

// Route to save
app.post('/api/hof/save', async (req, res) => {
    try {
        await HofSeason.findOneAndUpdate(
            { seasonName: req.body.seasonName }, 
            req.body, 
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Route to get list of seasons
app.get('/api/hof/seasons', async (req, res) => {
    const seasons = await HofSeason.find({}, 'seasonName').sort({ _id: -1 });
    res.json(seasons);
});

// Route to get specific season data
app.get('/api/hof/data/:name', async (req, res) => {
    const data = await HofSeason.findOne({ seasonName: req.params.name });
    res.json(data);
});
// --- NEW: FETCH PLAYER PROFILE WITH FULL HISTORY ---
app.get('/api/players/profile/:id', async (req, res) => {
    try {
        const player = await Player.findById(req.params.id);
        if (!player) return res.status(404).json({ message: "Player not found" });

        // Find all matches where this player was either Player A or Player B
        const matches = await Fixture.find({
            $or: [ { playerA: player.name }, { playerB: player.name } ],
            status: "Completed"
        }).sort({ createdAt: -1 });

        res.json({ player, matches });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/teams/create', async (req, res) => {
    try {
        const newTeam = new Team(req.body);
        await newTeam.save();
        
        // Automatically update the teamName and teamLogo for all selected members in the Player collection
        if (req.body.members && req.body.members.length > 0) {
            await Player.updateMany(
                { name: { $in: req.body.members } },
                { $set: { teamName: req.body.name, teamLogo: req.body.logo } }
            );
        }
        res.json({ success: true, message: "Team Created and Members assigned!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- UPDATED LOYALTY SCHEMA ---
const LoyaltySchema = new mongoose.Schema({
    applicationId: { type: String, unique: true }, // e.g., NEX-123456
    playerName: String,
    phoneNumber: String,
    cardNumber: { type: String, default: "PENDING" },
    tier: { type: String, default: 'NONE' },
    barcodeData: { type: String, default: "" },
    status: { type: String, default: 'Pending' }, // Pending, Approved, Expired
    issueDate: { type: Date },
    expiryDate: { type: Date }
});
const LoyaltyCard = mongoose.model('LoyaltyCard', LoyaltySchema);
// --- UPDATED ROUTES ---

// 1. Application with auto-generated ID
app.post('/api/loyalty/apply', async (req, res) => {
    try {
        const { playerName, phoneNumber } = req.body;

        // 1. Check if this phone number is already in our system
        const existingApp = await LoyaltyCard.findOne({ phoneNumber });

        if (existingApp) {
            return res.status(200).json({ 
                success: true, 
                alreadyExists: true,
                applicationId: existingApp.applicationId,
                message: "This number is already registered. Here is your ID." 
            });
        }

        // 2. If it's a new number, generate ID and save
        const appId = 'NEX-' + Math.floor(100000 + Math.random() * 900000);
        const application = new LoyaltyCard({ 
            applicationId: appId,
            playerName, 
            phoneNumber 
        });

        await application.save();
        res.json({ success: true, applicationId: appId });

    } catch (err) {
        console.error("Loyalty Error:", err);
        res.status(500).json({ error: "System Error. Please try later." });
    }
});

// 2. Search Application Status
app.get('/api/loyalty/status/:appId', async (req, res) => {
    const card = await LoyaltyCard.findOne({ applicationId: req.params.appId });
    if (!card) return res.status(404).json({ error: "Application ID not found." });
    
    // Auto-check for expiry
    if (card.status === 'Approved' && new Date() > new Date(card.expiryDate)) {
        card.status = 'Expired';
        await card.save();
    }
    res.json(card);
});

// 2. Admin Approves and Assigns Tier
app.put('/api/loyalty/approve/:id', async (req, res) => {
    try {
        const { tier } = req.body;
        const cardNumber = Array.from({length: 4}, () => Math.floor(1000 + Math.random() * 9000)).join('-');
        const barcodeData = `NXS-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const update = {
            tier,
            cardNumber,
            barcodeData,
            status: 'Approved',
            issueDate: new Date(),
            expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 2 Months
        };

        await LoyaltyCard.findByIdAndUpdate(req.params.id, update);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// --- ROUTES ---

// 1. Register Card
app.post('/api/loyalty/register', async (req, res) => {
    try {
        const { playerName, tier } = req.body;
        
        // Generate 16 digit number: XXXX-XXXX-XXXX-XXXX
        const cardNumber = Array.from({length: 4}, () => Math.floor(1000 + Math.random() * 9000)).join('-');
        const barcodeData = `NXS-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const card = new LoyaltyCard({
            playerName,
            cardNumber,
            tier,
            barcodeData,
            expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 2 Months
        });
        
        await card.save();
        res.json({ success: true, card });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Validate Barcode (For Scanner)
app.get('/api/loyalty/validate/:barcode', async (req, res) => {
    const card = await LoyaltyCard.findOne({ barcodeData: req.params.barcode });
    if (!card) return res.status(404).json({ message: "Invalid Card" });
    
    const isExpired = new Date() > new Date(card.expiryDate);
    res.json({ 
        valid: !isExpired, 
        card, 
        message: isExpired ? "CARD EXPIRED: Please Renew" : "ACCESS GRANTED" 
    });
});

// 3. Renew Card
app.put('/api/loyalty/renew/:id', async (req, res) => {
    const newExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    await LoyaltyCard.findByIdAndUpdate(req.params.id, { expiryDate: newExpiry, status: 'Active' });
    res.json({ success: true, newExpiry });
});
// --- MASTER WIPE: CLEARS ALL VISIBLE HISTORY ---
app.put('/api/danger/wipe-match-history', async (req, res) => {
    try {
        // 1. Delete all match records (This clears Player.html and Fixture lists)
        await Fixture.deleteMany({});
        await AuctionFixture.deleteMany({});
        await SoloFixture.deleteMany({});

        // 2. Delete all points table data (This clears Index.html Points Table)
        await Standing.deleteMany({});

        // 3. Delete all Golden Boot/Rank data (This clears the Boot list)
        await TourRank.deleteMany({});

        // 4. Clear the internal arrays in Player documents
        await Player.updateMany({}, { 
            $set: { 
                matches: [],
                "seasonStats.wins": 0,
                "seasonStats.draws": 0,
                "seasonStats.losses": 0,
                "seasonStats.goals": 0
            } 
        });

        res.json({ success: true, message: "History Wiped: Index, Player profiles, and Tables are now fresh." });
    } catch (err) {
        res.status(500).json({ error: "Failed to execute Master Wipe: " + err.message });
    }
});
app.get('/api/smart/recalculate-table/:tourId', async (req, res) => {
    try {
        const { tourId } = req.params;

        // 1. Get Tournament to find all participants
        const tour = await mongoose.model('Tournament').findById(tourId);
        if (!tour) return res.status(404).json({ error: "Tour not found" });

        // 2. Clear old standings for this tour
        await mongoose.model('Standing').deleteMany({ tourId });

        // 3. Create fresh empty entries for ALL participants
        const initialStandings = tour.participants.map(p => ({
            tourId, participant: p, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0
        }));
        await mongoose.model('Standing').insertMany(initialStandings);

        // 4. Get all COMPLETED matches
        const matches = await mongoose.model('Fixture').find({ tourId, status: "Completed" });

        for (let m of matches) {
            const updateStats = async (name, myS, oppS) => {
                let w = myS > oppS ? 1 : 0;
                let d = myS === oppS ? 1 : 0;
                let l = myS < oppS ? 1 : 0;
                let pts = (myS > oppS) ? 3 : (myS === oppS ? 1 : 0);

                await mongoose.model('Standing').findOneAndUpdate(
                    { tourId, participant: name },
                    { $inc: { played: 1, wins: w, draws: d, losses: l, gf: myS, ga: oppS, points: pts } }
                );
            };
            await updateStats(m.playerA, m.scoreA, m.scoreB);
            await updateStats(m.playerB, m.scoreB, m.scoreA);
        }

        res.json({ success: true, message: "Table rebuilt successfully!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- DELETE SPECIFIC TOURNAMENT & ALL RELATED DATA ---
app.delete('/api/smart/delete-tour/:id', async (req, res) => {
    try {
        const tourId = req.params.id;

        // 1. Delete the Tournament record
        await Tournament.findByIdAndDelete(tourId);

        // 2. Delete all Fixtures linked to this tour
        await Fixture.deleteMany({ tourId: tourId });

        // 3. Delete all Standings linked to this tour
        await Standing.deleteMany({ tourId: tourId });

        res.json({ success: true, message: "Tournament and all related data purged." });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete tournament." });
    }
});
// 1. GET Team Members (for dropdowns)
app.get('/api/teams/members/:teamName', async (req, res) => {
    try {
        const players = await Player.find({ teamName: req.params.teamName }, 'name');
        res.json(players);
    } catch (err) { res.status(500).json(err); }
});

// 2. CREATE Sub-Fixture
app.post('/api/smart/create-sub-fixture', async (req, res) => {
    try {
        const { tourId, parentFixtureId, playerA, playerB } = req.body;
        const subFix = new Fixture({
            tourId,
            isSubFixture: true, // <--- MAKE SURE THIS LINE EXISTS
            parentFixtureId,
            playerA,
            playerB,
            status: "Upcoming"
        });
        await subFix.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// 3. FETCH Sub-Fixtures for index page
app.get('/api/smart/sub-fixtures/:parentId', async (req, res) => {
    try {
        const subs = await Fixture.find({ parentFixtureId: req.params.parentId });
        res.json(subs);
    } catch (err) { res.status(500).json(err); }
});
// --- SMART CAPTAIN ASSIGNMENT ---
app.put('/api/teams/assign-captain', async (req, res) => {
    try {
        const { playerId, teamName } = req.body;

        // 1. Remove captain status from EVERYONE in this team
        await Player.updateMany({ teamName: teamName }, { $set: { isCaptain: false } });

        // 2. Assign the new captain
        await Player.findByIdAndUpdate(playerId, { $set: { isCaptain: true } });

        res.json({ success: true, message: "New Captain Commissioned." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- 1. DELETE SPECIFIC TOURNAMENT ---
app.delete('/api/smart/delete-tour/:id', async (req, res) => {
    try {
        const tourId = req.params.id;
        // Delete the tour, its matches, and its points table entries
        await Tournament.findByIdAndDelete(tourId);
        await Fixture.deleteMany({ tourId: tourId });
        await Standing.deleteMany({ tourId: tourId });
        res.json({ success: true, message: "Tournament and all related data purged." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. DELETE INDIVIDUAL FIXTURE ---
app.delete('/api/smart/delete-fixture/:id', async (req, res) => {
    try {
        await Fixture.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Fixture removed from database." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// --- NEW TELEMETRY ROUTE ---
app.get('/api/admin/telemetry', async (req, res) => {
    try {
        // 1. Get Database Stats (Size, Collections, Objects)
        const stats = await mongoose.connection.db.command({ dbStats: 1 });
        
        // 2. Measure Latency (Ping)
        const start = Date.now();
        await mongoose.connection.db.command({ ping: 1 });
        const latency = Date.now() - start;

        res.json({
            success: true,
            storage: {
                totalCapacity: 512, // Atlas M0 is 512MB
                usedBytes: stats.storageSize, // Real bytes used
                dataSize: stats.dataSize,
                collections: stats.collections,
                objects: stats.objects // Total "Players + Matches"
            },
            network: {
                latency: latency,
                status: "OPTIMAL",
                uptime: process.uptime() // How long your backend has been running
            },
            cluster: {
                provider: "AWS",
                region: "ap-south-1 (Mumbai)",
                version: "8.0.29"
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// --- FINAL DATA SYNC FIX ---
app.get('/api/admin/fix-logos', async (req, res) => {
    try {
        // 1. Access the specific 'teams' collection from your Auction Database
        // We use .collection() to avoid schema conflicts
        const AuctionTeams = mongoose.connection.db.collection('teams');
        
        // 2. Get all players who have a team assigned
        const players = await Player.find({ teamName: { $exists: true, $ne: "" } });
        
        let count = 0;
        let logs = [];

        for (let p of players) {
            // Clean the name (Removes prices like "(200M)" and trims spaces)
            const cleanTeamName = p.teamName.split(' (')[0].trim();

            // 3. Find the team using Case-Insensitive matching
            // This matches "man city" or "MAN CITY" to "MAN. CITY" correctly
            const teamInfo = await AuctionTeams.findOne({ 
                name: { $regex: new RegExp('^' + cleanTeamName.replace('.', '\\.') + '$', 'i') } 
            });

            if (teamInfo) {
                // 4. MAP 'logoUrl' from your screenshot to 'teamLogo' in your Player DB
                if (teamInfo.logoUrl) {
                    await Player.findByIdAndUpdate(p._id, { 
                        teamLogo: teamInfo.logoUrl 
                    });
                    count++;
                } else {
                    logs.push(`Team "${cleanTeamName}" found, but 'logoUrl' field is empty in DB.`);
                }
            } else {
                logs.push(`Could not find team matching: "${cleanTeamName}"`);
            }
        }

        res.json({ 
            success: true, 
            message: `SYNC COMPLETE: Updated ${count} players with official logos!`,
            details: logs 
        });
    } catch (err) {
        console.error("Sync Crash:", err);
        res.status(500).json({ error: err.message });
    }
});
// --- UPDATED MANAGEMENT SCHEMA ---
const RequestSchema = new mongoose.Schema({
    requestType: { type: String, enum: ['ISSUE', 'SUBSTITUTION', 'ID_CHANGE', 'REPLACEMENT'] },
    requestID: { type: String, unique: true },
    status: { type: String, default: 'Pending' },
    timestamp: { type: Date, default: Date.now },
    
    // Shared Field
    teamName: String,

    // Specific Fields (Mapped to your images)
    data: {
        // Issue Reporting
        playerName: String,
        oppoTeamName: String,
        oppoPlayerName: String,
        issueDescription: String,

        // Substitution
        subIn: String, // Name & No.
        subOut: String, // Name & No.

        // ID Change
        playerTag: String,
        oldID: String,
        newID: String,
        newIDName: String,

        // Replacement (Deep Data)
        repIn: { name: String, div: String, rank: String, id: String, tag: String },
        repOut: { name: String, div: String, rank: String, id: String, tag: String }
    }
});
const ManagementRequest = mongoose.model('ManagementRequest', RequestSchema);

// API Route to submit
app.post('/api/requests/submit', async (req, res) => {
    const reqID = 'NXS-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    const newReq = new ManagementRequest({ ...req.body, requestID: reqID });
    await newReq.save();
    res.json({ success: true, requestID: reqID });
});
app.get('/api/requests/all', async (req, res) => {
    const list = await ManagementRequest.find().sort({ timestamp: -1 });
    res.json(list);
});

// 3. Admin: Update Status
app.put('/api/requests/status/:id', async (req, res) => {
    await ManagementRequest.findByIdAndUpdate(req.params.id, { status: req.body.status });
    res.json({ success: true });
});

// 4. Public: Track/Fetch for Certificate
app.get('/api/requests/track/:reqID', async (req, res) => {
    const data = await ManagementRequest.findOne({ requestID: req.params.reqID });
    res.json(data);
});
// --- RUN THIS ONCE: https://pes-park-backend.onrender.com/api/admin/clean-nms ---
app.get('/api/admin/clean-nms', async (req, res) => {
    // Delete any request that doesn't have a type or teamName
    const result = await ManagementRequest.deleteMany({ 
        $or: [{ requestType: { $exists: false } }, { teamName: { $exists: false } }] 
    });
    res.json({ message: `Purged ${result.deletedCount} broken test entries.` });
});
// --- MASTER HISTORICAL SYNC ---
app.get('/api/danger/sync-player-stats-from-history', async (req, res) => {
    try {
        console.log("Starting Global Player Stat Sync...");

        // 1. RESET ALL PLAYERS TO STARTING STATE
        // We set BDR to 0 and clear Match History.
        // We set Market Value back to the original Auction Price.
        const players = await Player.find();
        for (let p of players) {
            await Player.findByIdAndUpdate(p._id, {
                bdrPoints: 0,
                matches: [],
                marketValue: p.auctionPrice || 0 // MV starts at what they were bought for
            });
        }

        // 2. FETCH ALL COMPLETED MATCHES (In order they happened)
        const completedMatches = await Fixture.find({ status: "Completed" }).sort({ createdAt: 1 });

        for (let m of completedMatches) {
            // Get the tournament type for this match
            const tour = await Tournament.findById(m.tourId);
            const tourType = tour ? tour.type : "auction";

            // 3. RUN THE NEW REWARDS LOGIC FOR EACH OLD MATCH
            // Player A
            await applyRewards(m.playerA, m.scoreA, m.scoreB, tourType, m.tourId, m.isSubFixture, m.playerB);
            // Player B
            await applyRewards(m.playerB, m.scoreB, m.scoreA, tourType, m.tourId, m.isSubFixture, m.playerA);
        }

        res.json({ 
            success: true, 
            message: `Neural Link Synced! Processed ${completedMatches.length} matches for ${players.length} players.` 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
// --- SYNC SQUAD IMAGES FROM AUCTION DATABASE ---
app.get('/api/danger/sync-squad-images', async (req, res) => {
    try {
        // 1. Access the 'players' collection from the Auction database
        const AuctionPlayers = mongoose.connection.db.collection('players');
        
        // 2. Get all players from your current Community database
        const communityPlayers = await Player.find();
        let count = 0;

        for (let p of communityPlayers) {
            // Find the matching player in the Auction DB
            const aPlayer = await AuctionPlayers.findOne({ 
                name: { $regex: new RegExp("^" + p.name.trim() + "$", "i") } 
            });

            // If found and the auction site has a squad image
            if (aPlayer && aPlayer.imageUrl) {
                await Player.findByIdAndUpdate(p._id, { 
                    squadImage: aPlayer.imageUrl
                });
                count++;
            }
        }

        res.json({ 
            success: true, 
            message: `SYNC COMPLETE: Imported ${count} squad images from Auction Archive.` 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to connect to Auction Archive." });
    }
});
// --- NEW: AGGREGATE GOALS FROM SUB-MATCHES ---
app.get('/api/smart/tour-goals/:tourId', async (req, res) => {
    try {
        const { tourId } = req.params;
        
        // 1. Find all completed member matches (sub-fixtures) for this tour
        const subMatches = await Fixture.find({ 
            tourId: tourId, 
            isSubFixture: true, 
            status: "Completed" 
        });

        const goalMap = {};

        // 2. Loop through matches and sum goals
        subMatches.forEach(m => {
            // Player A
            if (!goalMap[m.playerA]) goalMap[m.playerA] = 0;
            goalMap[m.playerA] += (m.scoreA || 0);
            // Player B
            if (!goalMap[m.playerB]) goalMap[m.playerB] = 0;
            goalMap[m.playerB] += (m.scoreB || 0);
        });

        // 3. Convert Map to Array and fetch player details (Team & Image)
        const sortedList = await Promise.all(Object.keys(goalMap).map(async (name) => {
            const pData = await Player.findOne({ name: name }).select('name teamName teamLogo image');
            return {
                name: name,
                goals: goalMap[name],
                team: pData ? pData.teamName : "Free Agent",
                logo: pData ? pData.teamLogo : "",
                image: pData ? pData.image : ""
            };
        }));

        // 4. Sort by highest goals
        sortedList.sort((a, b) => b.goals - a.goals);

        res.json(sortedList);
    } catch (err) {
        res.status(500).json({ error: "Failed to calculate goals" });
    }
});
// --- NEW: GLOBAL GOLDEN BOOT AGGREGATOR ---
app.get('/api/stats/global-golden-boot', async (req, res) => {
    try {
        // Find all goal records across ALL tours (solo, auction, quick)
        const allGoalRecords = await TourRank.find({ category: "boot" });

        const globalStats = {};

        for (const record of allGoalRecords) {
            const name = record.playerName;
            if (!globalStats[name]) {
                // Fetch player details once to get the latest avatar/team
                const pData = await Player.findOne({ name }).select('image teamName teamLogo').lean();
                globalStats[name] = {
                    name: name,
                    totalGoals: 0,
                    team: pData ? pData.teamName : "Free Agent",
                    logo: pData ? pData.teamLogo : "",
                    image: pData ? pData.image : ""
                };
            }
            globalStats[name].totalGoals += record.totalValue;
        }

        // Convert to array and sort by highest total goals
        const result = Object.values(globalStats).sort((a, b) => b.totalGoals - a.totalGoals);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Failed to aggregate global stats" });
    }
});
// --- 1. NEW TROPHY DEFINITION SCHEMA ---
const TrophyDefSchema = new mongoose.Schema({
    name: String,
    image: String, // ImgBB URL
    category: { type: String, default: 'custom' } // 'core' or 'custom'
});
const TrophyDef = mongoose.model('TrophyDef', TrophyDefSchema);

// Create a new Trophy type
app.post('/api/trophies/define', async (req, res) => {
    const newTrophy = new TrophyDef(req.body);
    await newTrophy.save();
    res.json({ success: true });
});

// Award Core Trophy (+1 to count)
app.put('/api/trophies/award-core', async (req, res) => {
    try {
        const { playerId, type } = req.body; // type will be 'ballonDor', etc.

        // Safety: Prevent script from crashing if type is missing
        if (!type) return res.status(400).json({ error: "Trophy type required" });

        // Build the dynamic path: e.g., "trophies.ballonDor"
        const updatePath = `trophies.${type}`;
        
        const updatedPlayer = await Player.findByIdAndUpdate(
            playerId, 
            { $inc: { [updatePath]: 1 } }, // Adds 1 to the current count
            { new: true }
        );

        res.json({ success: true, newCount: updatedPlayer.trophies[type] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Award Custom Trophy (Add to array)
app.put('/api/trophies/award-custom', async (req, res) => {
    const { playerId, trophyId } = req.body;
    const trophy = await TrophyDef.findById(trophyId);
    await Player.findByIdAndUpdate(playerId, { 
        $push: { customTrophies: { name: trophy.name, image: trophy.image } } 
    });
    res.json({ success: true });
});

// Get all Trophy Definitions
app.get('/api/trophies/list', async (req, res) => {
    res.json(await TrophyDef.find());
});
app.get('/api/admin/sync-new-logos', async (req, res) => {
    try {
        const AuctionTeams = mongoose.connection.db.collection('teams');
        
        // Find players who have a team name but NO logo saved
        const playersMissingLogos = await Player.find({ 
            teamName: { $exists: true, $ne: "" },
            $or: [{ teamLogo: { $exists: false } }, { teamLogo: "" }]
        });

        let count = 0;
        for (let p of playersMissingLogos) {
            // Clean the team name to handle potential extra info in brackets
            const cleanName = p.teamName.split(' (')[0].trim();
            
            // Search for the team in the teams collection (Case-insensitive)
            const teamInfo = await AuctionTeams.findOne({ 
                name: { $regex: new RegExp('^' + cleanName.replace('.', '\\\\.') + '$', 'i') } 
            });

            if (teamInfo && teamInfo.logoUrl) {
                // Update the player record with the found logo
                await Player.findByIdAndUpdate(p._id, { teamLogo: teamInfo.logoUrl });
                count++;
            }
        }
        res.json({ success: true, message: `Tactical Sync Complete: ${count} new logos imported.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// --- NEW: TEAM BDR CHAMPIONSHIP AGGREGATOR ---
app.get('/api/stats/team-bdr', async (req, res) => {
    try {
        // 1. Get all players who belong to a team
        const players = await Player.find({ teamName: { $exists: true, $ne: "" } });

        const teamsMap = {};

        players.forEach(p => {
            if (!teamsMap[p.teamName]) {
                teamsMap[p.teamName] = {
                    name: p.teamName,
                    logo: p.teamLogo,
                    totalBDR: 0,
                    playerCount: 0,
                    members: []
                };
            }
            teamsMap[p.teamName].totalBDR += (p.bdrPoints || 0);
            teamsMap[p.teamName].playerCount += 1;
            // Push member info for the expanded view
            teamsMap[p.teamName].members.push({
                name: p.name,
                bdr: p.bdrPoints || 0,
                // Calculate a simple 'Grade' based on BDR
                grade: (p.bdrPoints > 20) ? 'S-grade' : (p.bdrPoints > 10 ? 'A-grade' : 'B-grade'),
                image: p.image
            });
        });

        // 2. Convert to array and sort by total BDR points
        const result = Object.values(teamsMap).sort((a, b) => b.totalBDR - a.totalBDR);
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Neural Link Sync Failed" });
    }
});
// --- CALENDAR SCHEMA ---
const EventSchema = new mongoose.Schema({
    title: String,
    date: String, // Format: YYYY-MM-DD
    type: { type: String, enum: ['league', 'weekly', 'ucl', 'playoff', 'auction'] }
});
const CalendarEvent = mongoose.model('CalendarEvent', EventSchema);

// --- ROUTES ---
app.get('/api/calendar/events', async (req, res) => {
    const events = await CalendarEvent.find();
    res.json(events);
});

app.post('/api/calendar/events', async (req, res) => {
    const newEvent = new CalendarEvent(req.body);
    await newEvent.save();
    res.json({ success: true });
});

app.delete('/api/calendar/events/:id', async (req, res) => {
    await CalendarEvent.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});
// --- SELECTIVE REWARD SYNC (AUCTION & SOLO ONLY) ---
app.get('/api/smart/sync-pro-rewards', async (req, res) => {
    try {
        // 1. Reset BDR and Market Value to base values first
        // We set BDR to 0 and Market Value back to the initial Auction Price
        const players = await Player.find();
        for (let p of players) {
            p.bdrPoints = 0;
            p.marketValue = p.auctionPrice || 0; // Starts fresh from what they were bought for
            await p.save();
        }

        // 2. Identify target tournaments (Only Auction and Solo)
        const targetTours = await Tournament.find({ 
            type: { $in: ['auction', 'solo'] } 
        });
        const tourIds = targetTours.map(t => t._id);

        // 3. Fetch completed matches only from these tours
        const matches = await Fixture.find({ 
            tourId: { $in: tourIds }, 
            status: "Completed" 
        });

        // 4. Process matches and apply rewards
        for (let m of matches) {
            const tour = targetTours.find(t => t._id.toString() === m.tourId.toString());
            const tType = tour.type;

            const calcRewards = (s1, s2) => {
                // Standard Logic: Win(+5/15M), Draw(+1/0M), Loss(-3/-10M) + Goals(+1/3M)
                let bdr = (s1 > s2 ? 5 : (s1 === s2 ? 1 : -3)) + (s1 * 1);
                let mv = (s1 > s2 ? 15 : (s1 === s2 ? 0 : -10)) + (s1 * 3);
                let rankPts = (s1 > s2 ? 3 : (s1 === s2 ? 1 : 0));
                return { bdr, mv, rankPts };
            };

            // Player A Update
            const resA = calcRewards(m.scoreA, m.scoreB);
            await Player.findOneAndUpdate({ name: m.playerA }, { $inc: { bdrPoints: resA.bdr, marketValue: resA.mv } });
            
            // Player B Update
            const resB = calcRewards(m.scoreB, m.scoreA);
            await Player.findOneAndUpdate({ name: m.playerB }, { $inc: { bdrPoints: resB.bdr, marketValue: resB.mv } });

            // Sync Rankings (Golden Boot/Best Player) for these specific tours
            await TourRank.findOneAndUpdate({ tour: tType, category: "best", playerName: m.playerA }, { $inc: { totalValue: resA.rankPts } }, { upsert: true });
            await TourRank.findOneAndUpdate({ tour: tType, category: "boot", playerName: m.playerA }, { $inc: { totalValue: m.scoreA } }, { upsert: true });
            await TourRank.findOneAndUpdate({ tour: tType, category: "best", playerName: m.playerB }, { $inc: { totalValue: resB.rankPts } }, { upsert: true });
            await TourRank.findOneAndUpdate({ tour: tType, category: "boot", playerName: m.playerB }, { $inc: { totalValue: m.scoreB } }, { upsert: true });
        }

        res.json({ success: true, message: `Successfully synced rewards for ${matches.length} Pro-Tour matches. Quick Tour was excluded.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- SMART FETCH: HANDLES BOTH UNIQUE ID AND TEAM NAME ---
app.get('/api/teams/profile-by-id/:id', async (req, res) => {
    try {
        const input = req.params.id;
        let team;

        // 1. Try to find by MongoDB ID first (if the string is the right length)
        if (input.match(/^[0-9a-fA-F]{24}$/)) {
            team = await mongoose.model('Team').findById(input);
        }

        // 2. If not found by ID, search by Name (This fixes the "INTER MILAN" error)
        if (!team) {
            team = await mongoose.model('Team').findOne({ 
                name: { $regex: new RegExp("^" + input + "$", "i") } 
            });
        }

        if (!team) return res.status(404).json({ error: "Team not found in Database" });

        const teamName = team.name;

        // 3. Fetch players and matches as usual
        const players = await mongoose.model('Player').find({ teamName: teamName });
        const matches = await mongoose.model('Fixture').find({
            $or: [{ playerA: teamName }, { playerB: teamName }],
            status: "Completed"
        }).sort({ createdAt: -1 }).limit(10);

        const trophies = []; // Fetch from HofSeason if needed

        res.json({ 
            team: {
                name: team.name,
                logo: team.logo || team.logoUrl || 'https://via.placeholder.com/100',
                budget: team.budget || 0
            }, 
            players, 
            matches, 
            trophies 
        });

    } catch (err) {
        console.error("Backend Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Admin Server running on ${PORT}`));
