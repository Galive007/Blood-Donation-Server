const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express')
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 4000



const app = express();
app.use(cors())
app.use(express.json())

// const serviceAccount = require("./firebase-admin-key.json");
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(idToken)
        console.log('decoded info', decoded);
        req.decoded_email = decoded.email
        next()
    }
    catch (error) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
}



const uri = `mongodb+srv://${process.env.USER}:${process.env.PASSWORD}@cluster0.zbtu92j.mongodb.net/?appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const database = client.db('blooddonation')
        const userCollection = database.collection('user')
        const bloodRequestsCollection = database.collection('bloodRequest')


        app.post('/users', async (req, res) => {
            const userInfo = req.body
            userInfo.createdAt = new Date()
            userInfo.role = 'donor'
            userInfo.status = 'active'
            const result = await userCollection.insertOne(userInfo)
            res.send(result)
        })

        app.get('/users', verifyFBToken, async (req, res) => {
            const result = await userCollection.find().toArray()
            res.status(200).send(result)
        })

        app.get('/users/role/:email',async(req,res)=>{
            const {email}=req.params
            // console.log(email);
            const query={email:email}
            const result=await userCollection.findOne(query)
            // console.log(result);
            res.send(result)
        })

        // app.get('/users/:email',async(req,res)=>{
        //     const email=req.params.email
        //     const query={email:email}
        //     const result=await userCollection.findOne(query)
        //     res.send(result)
        // })

        app.patch('/update/user/status',verifyFBToken,async(req,res)=>{
            const {email,status}=req.query
            const query={email:email}

            const updateStatus={
                $set:{
                    status:status
                }
            }
            const result=await userCollection.updateOne(query,updateStatus)
            res.send(result)
        })



        // BLOOD Request
        app.post('/requests', verifyFBToken, async (req, res) => {
            const data = req.body
            data.createdAt = new Date()
            const result = await bloodRequestsCollection.insertOne(data)
            res.send(result)
        })

        app.get('/donor/requests/:email', async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await bloodRequestsCollection.find(query).toArray()
            res.send(result)
        })

        // All-requests
        // app.get('/requests', async (req, res) => {
        //     const result = await bloodRequestsCollection.find().toArray()
        //     res.send(result)
        // })
        app.get('/my-request',async(req,res)=>{
            const email=req.query.email
            const result=await bloodRequestsCollection.find({email:email}).toArray()
            res.send(result)
        })


        app.get('/', (req, res) => {
            res.send('This SERVER For Blood Donation')
        })

        app.listen(port, () => {
            console.log(`Server is Running On ${port}`);
        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close(); 
    }
}
run().catch(console.dir);


