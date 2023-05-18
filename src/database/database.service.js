import mongoose from "mongoose";
import {LetterSchema} from "./LetterSchema.js";

const conn = mongoose.createConnection(process.env.CONNECTION_STRING);
export const letterModel = conn.model('Letter', LetterSchema);


export const saveLetterToDb = async (letter) => {
    const newLetter = new letterModel({...letter});
    await newLetter.save();
}

export const deleteLettersFromDb = async (arrayOfId) => {
    await letterModel.deleteMany({_id:{$in:[...arrayOfId]}});
}

export const findTodayLetters = async (date) => {
    return letterModel.find({date});
}

export const findUserLetters = async (chatId) => {
    return letterModel.find({chatId});
}

export const deleteUserLetters = async (chatId) => {
    await letterModel.deleteMany({chatId:chatId});
}