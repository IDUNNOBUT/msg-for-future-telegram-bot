import {Schema} from "mongoose";

export const LetterSchema = new Schema({
    chatId: Number,
    text: String,
    date: String,
});