import nodemailer from 'nodemailer';
export function makeTransport() {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        console.warn('Missing GMAIL_USER/GMAIL_PASS, email sending will fail');
    }
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS, // App Password recommended
        },
    });
}
