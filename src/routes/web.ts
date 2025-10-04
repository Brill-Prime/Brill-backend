import express from 'express';

const router = express.Router();

router.get('/auth/success', (req, res) => {
    const { provider } = req.query;
    res.send(`<h1>Authentication with ${provider} was successful!</h1>`);
});

router.get('/auth/error', (req, res) => {
    const { provider } = req.query;
    res.send(`<h1>Authentication with ${provider} failed!</h1>`);
});

export default router;