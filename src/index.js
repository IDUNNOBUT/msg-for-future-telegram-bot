import 'dotenv/config'
import cron from "cron/lib/cron.js";
import TelegramBot from "node-telegram-bot-api";
import dateFns from "date-fns";
import {formatInTimeZone} from 'date-fns-tz'
import {
    deleteLettersFromDb,
    deleteUserLetters,
    findTodayLetters,
    findUserLetters,
    saveLetterToDb
} from "./database/database.service.js";
import {
    about, allDeleted,
    createLetter,
    Greeting,
    greetingSticker,
    noLetters,
    seeUAfter6months, seeUAfter9months,
    seeUAfterYear
} from "./template/phrase.templates.js";

const token = process.env.TOKEN;
const bot = new TelegramBot(token, {polling: true});
let tempDb = [];


const job = new cron.CronJob('0 0 12 * * *', checkScheduledLetters);
job.start();

const saveLetter = (letter) => {
    saveLetterToDb({chatId: letter.chatId, text: letter.text, date: letter.date}).then(async r => {
        tempDb = tempDb.filter((temp) => temp.chatId !== letter.chatId);
        for (let msgPart of letter.replyMsgId) {
            await bot.deleteMessage(letter.chatId, msgPart);
        }
    });
}

async function checkScheduledLetters() {
    const todayLetters = await findTodayLetters(formatInTimeZone(new Date, 'Europe/Moscow', 'dd/MM/yyyy'));
    if (todayLetters.length) {
        for (let letter of todayLetters) {
            await bot.sendMessage(letter.chatId, letter.text);
        }
        await deleteLettersFromDb(todayLetters.map(letter => letter.id));
    }
}

const createNewLetter = (chatId) => {
    tempDb.push({chatId, text: '', date: null});
    bot.sendMessage(chatId, createLetter, {reply_markup: JSON.stringify({force_reply: true})})
        .then(message => {
            tempDb = tempDb.map(letter => letter.chatId === chatId ? {
                ...letter,
                replyMsgId: [message.message_id]
            } : letter);
            const listenerId = bot.onReplyToMessage(chatId, message.message_id, (reply) => setTextWaitForTime(chatId, listenerId, reply));
        })
}

const setTextWaitForTime = async (chatId, listenerId, message) => {
    if(!message.text){
        await bot.sendMessage(chatId,'Поддерживаются только текстовые письма 😔');
        return;
    }
    try {
        bot.removeReplyListener(listenerId);
    }
    catch (e) {}
    tempDb = tempDb.map(letter => letter.chatId === chatId ? {
        ...letter,
        text: message.text,
        replyMsgId: [...letter?.replyMsgId, message.message_id]
    } : letter);
    await bot.sendMessage(chatId, 'Укажи, через какое время напомнить тебе о письме ⏳', {
        reply_markup: {
            inline_keyboard: [
                [{text: 'Через 6 месяцев', callback_data: '/sixMonths'}, {text: 'Через 9 месяцев', callback_data: '/nineMonths'}],
                [{text: 'Через год', callback_data: '/year'}, {text: 'Отмена ❌', callback_data: '/cancel'}],
                ]
        }
    })
}

const setTime = (chatId, time) => {
    tempDb = tempDb.map(letter => letter.chatId === chatId ? {
            ...letter,
            date: formatInTimeZone(dateFns.add(new Date, {months: time}), 'Europe/Moscow', 'dd/MM/yyyy')
        } : letter);
    saveLetter(tempDb.find(letter => letter.chatId === chatId));
}

const cancelLetter = (chatId) => {
    tempDb = tempDb.filter(letter => letter.chatId !== chatId);
}

const checkLetters = async (chatId) => {
    const userLetters = await findUserLetters(chatId);
    if (userLetters.length) {
        let template = userLetters.map((letter, index) => `${index + 1} - Будет доставлено: ${letter.date}`);
        template = template.join('\n');
        await bot.sendMessage(chatId, template,
            {
                reply_markup: {
                    inline_keyboard: [[{text: 'Очистить историю', callback_data: '/deleteall'}]]
                }
            });
        return;
    }
    await bot.sendMessage(chatId, noLetters);
}

bot.setMyCommands([
    {command: '/start', description: 'Начальное приветствие'},
    {command: '/newletter', description: 'Отправить новое письмо'},
    {command: '/check', description: 'Проверить наличие существующих писем'},
    {command: '/about', description: 'О сервисе'}
])

bot.onText(/\/start/, async (msg, match) => {
    const {id: chatId, first_name: name} = msg.chat;
    cancelLetter(chatId);
    await bot.sendSticker(chatId, greetingSticker);
    await bot.sendMessage(chatId, Greeting(name),
        {
            reply_markup: {
                inline_keyboard: [[{text: 'Написать письмо ✉', callback_data: '/newletter'}],
                    [{text: 'Проверить существующие письма', callback_data: '/check'}]]
            }
        });

})

bot.onText(/\/about/, async (msg, match) => {
    const {id: chatId} = msg.chat;
    await bot.sendMessage(chatId, about,
        {
            reply_markup: {
                inline_keyboard: [[{text: 'Без сменки 🌿', url: 'https://t.me/bezsmenki'}, {text: 'IDUNNO 👨🏻‍💻', url: 'https://t.me/Z3NT0N'}]]
            }
        });
})

bot.onText(/\/newletter/, (msg, match) => {
    const {id: chatId} = msg.chat;
    createNewLetter(chatId);
})

bot.onText(/\/check/, async (msg, match) => {
    const {id: chatId} = msg.chat;
    await checkLetters(chatId);
})

bot.on('callback_query', async msg => {
    const chatId = msg.from.id
    const currentSession = tempDb.find(letter => letter.chatId === chatId);
    switch (msg.data) {
        case '/check': {
            await checkLetters(chatId);
            break;
        }
        case '/newletter': {
            createNewLetter(chatId);
            break;
        }
        case '/cancel': {
            if (currentSession) {
                tempDb = tempDb.map(letter => letter.chatId === chatId ? {...letter, replyMsgId: [...letter.replyMsgId, msg.message.message_id]}
                    : letter);
                cancelLetter(chatId);
                await bot.sendMessage(chatId, 'Действие отменено');
            }
            break;
        }
        case '/sixMonths': {
            if (currentSession) {
                tempDb = tempDb.map(letter => letter.chatId === chatId ? {
                    ...letter,
                    replyMsgId: [...letter.replyMsgId, msg.message.message_id]
                } : letter);
                setTime(chatId, 6);
                await bot.sendMessage(chatId, seeUAfter6months);
            }
            break;
        }
        case '/nineMonths': {
            if (currentSession) {
                tempDb = tempDb.map(letter => letter.chatId === chatId ? {
                    ...letter,
                    replyMsgId: [...letter.replyMsgId, msg.message.message_id]
                } : letter);
                setTime(chatId, 9);
                await bot.sendMessage(chatId, seeUAfter9months);
            }
            break;
        }
        case '/year': {
            if (currentSession) {
                tempDb = tempDb.map(letter => letter.chatId === chatId ? {
                    ...letter,
                    replyMsgId: [...letter.replyMsgId, msg.message.message_id]
                } : letter);
                setTime(chatId, 12);
                await bot.sendMessage(chatId, seeUAfterYear);
            }
            break;
        }
        case '/deleteall': {
            await deleteUserLetters(chatId);
            await bot.sendMessage(chatId, allDeleted);
            break;
        }
    }
    await bot.answerCallbackQuery(msg.id);
})
