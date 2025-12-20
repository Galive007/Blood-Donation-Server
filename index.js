const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express')
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 4000
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require('crypto')



const app = express();
app.use(cors())
app.use(express.json())

// {
//     origin:['https://local-food-review.netlify.app']
// }

// const serviceAccount = require("./firebase-admin-key.json");
const admin = require("firebase-admin");
const { url } = require('inspector');
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
        // console.log('decoded info', decoded);
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
        // await client.connect();


        const database = client.db('blooddonation')
        const userCollection = database.collection('user')
        const bloodRequestsCollection = database.collection('bloodRequest')
        const paymentsCollection = database.collection('payments')


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

        app.get('/users/me', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const result = await userCollection.findOne({ email });
            res.send(result);
        });

        app.patch('/users/me', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const { name, avatar, district, upazila, blood } = req.body;

            const updateFields = {};
            if (name) updateFields.name = name;
            if (avatar) updateFields.avatar = avatar;
            if (district) updateFields.district = district;
            if (upazila) updateFields.upazila = upazila;
            if (blood) updateFields.blood = blood;

            const result = await userCollection.updateOne(
                { email },
                { $set: updateFields }
            );

            res.send(result);
        });

        // // GET 3 recent requests for current donor
        // app.get('/donor/recent-requests', async (req, res) => {
        //     const email = req.decoded_email;
        //     const recentRequests = await bloodRequestsCollection
        //         .find({ email })
        //         .sort({ createdAt: -1 }) // most recent first
        //         .limit(3)
        //         .toArray();
        //     res.send(recentRequests);
        // });



        app.get('/users/role/:email', async (req, res) => {
            const { email } = req.params
            // console.log(email);
            const query = { email: email }
            const result = await userCollection.findOne(query)
            // console.log(result);
            res.send(result)
        })

        app.get('/admin/dashboard-stats', verifyFBToken, async (req, res) => {
            const adminUser = await userCollection.findOne({
                email: req.decoded_email
            });
            if (adminUser?.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            const totalDonors = await userCollection.countDocuments({
                role: 'donor'
            });
            const totalBloodRequests = await bloodRequestsCollection.countDocuments();
            res.send({
                totalDonors,
                totalBloodRequests,
            });
        })


        // app.get('/users/:email',async(req,res)=>{
        //     const email=req.params.email
        //     const query={email:email}
        //     const result=await userCollection.findOne(query)
        //     res.send(result)
        // })

        app.patch('/update/user/status', verifyFBToken, async (req, res) => {
            const { email, status } = req.query
            const query = { email: email }

            const updateStatus = {
                $set: {
                    status: status
                }
            }
            const result = await userCollection.updateOne(query, updateStatus)
            res.send(result)
        })



        // BLOOD Request
        app.post('/add-requests', verifyFBToken, async (req, res) => {
            try {
                const data = req.body;
                data.email = req.decoded_email; // force correct email
                // console.log(data.email);

                data.createdAt = new Date();

                const result = await bloodRequestsCollection.insertOne(data);
                res.status(201).send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to create blood request' });
            }
        })

        app.get('/donor/requests/:email', async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await bloodRequestsCollection.find(query).toArray()
            res.send(result)
        })

        app.get('/donor/recent-requests',verifyFBToken,  async (req, res) => {
            try {
                const email = req.decoded_email;
                console.log(email);               
                const recentRequests = await bloodRequestsCollection
                    .find({ email })            
                    .sort({ createdAt: -1 })    
                    .limit(3)
                    .toArray();
                if (!recentRequests || recentRequests.length === 0) {
                    return res.send(); 
                }
                res.send(recentRequests);
            } catch (error) {
                console.error("Error fetching recent requests:", error);
                res.status(500).send({ message: 'Failed to load recent donation requests' });
            }
        });
        // All-requests
        app.get('/all-requests', async (req, res) => {
            const result = await bloodRequestsCollection
                .find()
                .toArray();

            res.send(result);
        });

        // donor-request
        app.get('/my-request', verifyFBToken, async (req, res) => {
            const email = req.decoded_email
            const page = Number(req.query.page)
            const skip = Number(req.query.skip)
            const size = Number(req.query.size)

            const query = { email: email }
            const result = await bloodRequestsCollection.find(query).limit(size).skip(size * page).toArray()

            const totalRequest = await bloodRequestsCollection.countDocuments(query)

            res.send({ request: result, totalRequest })
        })

        // search-request
        app.get('/search-requests', async (req, res) => {
            const { blood, district, upazila } = req.query
            // console.log(req.query);
            const query = {}
            if (!query) {
                return
            }
            if (blood) {
                const fixed = blood.replace(/ /g, "+").trim()
                query.blood = fixed
            }
            if (district) {
                query.district = district
            }
            if (upazila) {
                query.upazila = upazila
            }
            // console.log(query);
            const result = await bloodRequestsCollection.find(query).toArray()
            res.send(result)
        })


        // PaymentAddress
        app.post('/create-payment-checkout', async (req, res) => {
            const information = req.body
            console.log(information);
            const amount = parseInt(information.donateAmount) * 100;
            const session = await stripe.checkout.sessions.create({

                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: 'please Donate'
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    donarName: information.donarName
                },
                customer_email: information.donarEmail,
                success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`
            });
            res.send({ url: session.url })
        })

        app.post('/success-payment', async (req, res) => {
            const { session_id } = req.query
            // console.log(session_id);
            const session = await stripe.checkout.sessions.retrieve(
                session_id
            );
            // console.log(session);
            const transectionId = session.payment_intent
            // console.log(transectionId);


            if (session.payment_status == 'paid') {
                const paymentInfo = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    donarEmail: session.customer_email,
                    transectionId,
                    payment_status: session.payment_status,
                    paidAt: new Date()
                }
                const result = await paymentsCollection.insertOne(paymentInfo)
                return res.send(result)
            } else {
                return res.status(400).send({ message: 'Payment not successful' });
            }
        })

        // total-funds
        app.get('/admin/total-funds',verifyFBToken, async (req, res) => {
            try {
                const adminUser = await userCollection.findOne({ email: req.decoded_email });
                if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'volunteer')) {
                    return res.status(403).send({ message: 'Forbidden' });
                }

                const result = await paymentsCollection.aggregate([
                    { $match: { payment_status: 'paid' } },
                    { $group: { _id: null, totalFunds: { $sum: '$amount' } } }
                ]).toArray();

                res.send({ totalFunds: result[0]?.totalFunds || 0 });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to calculate total funds' });
            }
        });


        app.get('/', (req, res) => {
            res.send('This SERVER For Blood Donation')
        })

        app.listen(port, () => {
            console.log(`Server is Running On ${port}`);
        })


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close(); 
    }
}
run().catch(console.dir);


