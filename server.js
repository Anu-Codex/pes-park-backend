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

// UPDATE Player Stats (Dashboard & Profile)
app.put('/api/players/:id', async (req, res) => {
    try {
        console.log("Incoming Update for ID:", req.params.id);
        console.log("Data received:", req.body); // This will show if 'image' is empty or not

        const updatedPlayer = await Player.findByIdAndUpdate(
            req.params.id, 
            { $set: req.body }, 
            { new: true } // Returns the updated document
        );

        if (!updatedPlayer) {
            return res.status(404).json({ success: false, message: "Player not found" });
        }

        res.json({ success: true, player: updatedPlayer });
    } catch (err) {
        console.error("Update Error:", err);
        res.status(500).json({ success: false, error: err.message });
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
        const players = await P.find({ soldTo: { $regex: new RegExp('^' + teamName, 'i') } }).toArray();

        if (!team) return res.status(404).json({ error: "Team not found" });
        res.json({ team, players });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); // Add this to your Render Env Vars

app.post('/api/bot/groq-query', async (req, res) => {
    try {
        const { message } = req.body;

        // 1. Fetch current DB state to give Groq context
        const players = await Player.find({}, 'name marketValue bdrPoints teamName matches');
        
        // 2. Create a compact string of the database
        const dbContext = players.map(p => 
            `[${p.name}: MV=${p.marketValue}M, BDR=${p.bdrPoints}, Team=${p.teamName || 'Free Agent'}]`
        ).join(', ');

        // 3. Prompt Groq
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are the Nexus Legends eSports Official Bot. 
                    Use this real-time database context to answer user questions: ${dbContext}.
                    Be professional, use eSports terminology, and keep answers concise. 
                    If asked for advice, base it on MV and BDR points.`
                },
                { role: "user", content: message }
            ],
            model: "llama-3.1-8b-instant", // Fast and powerful
        });

        res.json({ reply: chatCompletion.choices[0].message.content });
    } catch (err) {
        console.error(err);
        res.status(500).json({ reply: "LOG ERROR: AI Neural Link interrupted. Try again." });
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
    const newPlayer = new Player(req.body);
    await newPlayer.save();
    res.json({ success: true });
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

const ADMIN_EMAIL = "admin@pes-park.com";
const ADMIN_PASS = "admin@pes-park123"; // You should use environment variables for this!

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
    stage: String,
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
// Check this route in your server.js
// 1. Route to CREATE a fixture (Used by Dashboard)
app.post('/api/smart/create-fixture', async (req, res) => {
    try {
        const { tourId, playerA, playerB } = req.body;
        if(!tourId || !playerA || !playerB) return res.status(400).json({message: "Missing data"});

        const newFixture = new Fixture({
            tourId,
            playerA,
            playerB,
            status: "Upcoming"
        });

        await newFixture.save();
        res.json({ success: true, message: "Fixture Created!" });
    } catch (err) {
        console.error("Create Fixture Error:", err);
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
app.put('/api/smart/update-score/:id', async (req, res) => {
    try {
        const { scoreA, scoreB } = req.body;
        const fixture = await Fixture.findById(req.params.id);
        if (!fixture || fixture.status === "Completed") return res.status(400).json({ error: "Invalid or already completed" });

        const tour = await Tournament.findById(fixture.tourId);
        const tourType = tour ? tour.type : "auction";

        // 1. UPDATE FIXTURE
        fixture.scoreA = scoreA;
        fixture.scoreB = scoreB;
        fixture.status = "Completed";
        await fixture.save();

        // 2. REWARD CALCULATION FUNCTION
        const applyRewards = async (pName, myScore, oppScore) => {
    if (!pName) return;

    let mvAdd = 0; // Value to add to Market Value
    let bdrAdd = 0;

    // Your logic for Win/Loss/Draw
    if (myScore > oppScore) { // WIN
        mvAdd = 15; bdrAdd = 5; 
    } else if (myScore === oppScore) { // DRAW
        mvAdd = 5; bdrAdd = 1;
    } else { // LOSS
        mvAdd = -10; bdrAdd = -3;
    }

    // Add goal bonus to Market Value
    mvAdd += (myScore * 3);

            // A. Update Player Global Stats (BDR & Market Value)
            await Player.findOneAndUpdate(
        { name: pName },
        { $inc: { marketValue: mvAdd, bdrPoints: bdrAdd } }
    );

            // B. Update Tournament Ranking (Best Player / Rating)
            await TourRank.findOneAndUpdate(
                { tour: tourType, category: "best", playerName: pName },
                { $inc: { totalValue: bpAdd } },
                { upsert: true }
            );

            // C. Update Tournament Ranking (Golden Boot / Goals)
            await TourRank.findOneAndUpdate(
                { tour: tourType, category: "boot", playerName: pName },
                { $inc: { totalValue: myScore } },
                { upsert: true }
            );

            // D. Update Points Table (Standings)
            const pts = (myScore > oppScore) ? 3 : (myScore === oppScore ? 1 : 0);
            await Standing.findOneAndUpdate(
                { tourId: fixture.tourId, participant: pName },
                { $inc: { 
                    played: 1, 
                    wins: myScore > oppScore ? 1 : 0, 
                    draws: myScore === oppScore ? 1 : 0, 
                    losses: myScore < oppScore ? 1 : 0, 
                    gf: myScore, ga: oppScore, points: pts 
                }}
            );
        };

        // Apply to both players
        await applyRewards(fixture.playerA, scoreA, scoreB);
        await applyRewards(fixture.playerB, scoreB, scoreA);

        res.json({ success: true });
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

        // 1. Reset all standings for this tour to 0
        await Standing.updateMany({ tourId }, { 
            played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 
        });

        // 2. Get all COMPLETED matches for this tour
        const matches = await Fixture.find({ tourId, status: "Completed" });

        for (let m of matches) {
            const getStats = (s1, s2) => {
                if (s1 > s2) return { w: 1, d: 0, l: 0, pts: 3 };
                if (s1 === s2) return { w: 0, d: 1, l: 0, pts: 1 };
                return { w: 0, d: 0, l: 1, pts: 0 };
            };

            const resA = getStats(m.scoreA, m.scoreB);
            const resB = getStats(m.scoreB, m.scoreA);

            // Update Player A
            await Standing.findOneAndUpdate(
                { tourId, participant: m.playerA },
                { $inc: { played: 1, wins: resA.w, draws: resA.d, losses: resA.l, gf: m.scoreA, ga: m.scoreB, points: resA.pts } }
            );
            // Update Player B
            await Standing.findOneAndUpdate(
                { tourId, participant: m.playerB },
                { $inc: { played: 1, wins: resB.w, draws: resB.d, losses: resB.l, gf: m.scoreB, ga: m.scoreA, points: resB.pts } }
            );
        }

        res.json({ success: true, message: "Points table updated from match history!" });
    } catch (err) {
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
const HofSeasonSchema = new mongoose.Schema({
    seasonName: String,
    specialHighlights: [{ label: String, value: String }],
    trophyWinners: [{ title: String, winner: String, runner: String }]
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


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Admin Server running on ${PORT}`));
