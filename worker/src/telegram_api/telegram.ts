import { Context } from "hono";
import { Telegraf, Context as TgContext, Markup } from "telegraf";
import { callbackQuery } from "telegraf/filters";
import * as OTPAuth from "otpauth"; 

// --- IMPORT FAKER (ASIA & EROPA) ---
import { 
    type Faker,
    fakerEN_US, // Default (US)
    // Asia
    fakerID_ID, fakerJA, fakerKO, fakerZH_CN, fakerZH_TW, fakerVI, fakerTH, fakerEN_IN, fakerNE, fakerTR,
    // Eropa
    fakerEN_GB, fakerFR, fakerDE, fakerIT, fakerES, fakerRU, fakerUK, fakerPL, fakerNL, fakerPT_PT, fakerSV, fakerFI, fakerCS_CZ
} from '@faker-js/faker';

import { CONSTANTS } from "../constants";
import { getBooleanValue, getDomains, getJsonObjectValue, getStringValue } from '../utils';
import { TelegramSettings } from "./settings";
import { bindTelegramAddress, deleteTelegramAddress, jwtListToAddressData, tgUserNewAddress, unbindTelegramAddress, unbindTelegramByAddress } from "./common";
import { commonParseMail } from "../common";
import { UserFromGetMe } from "telegraf/types";
import i18n from "../i18n";
import { LocaleMessages } from "../i18n/type";

// Helper to get messages by userId
const getTgMessages = async (
    c: Context<HonoCustomType>,
    ctx?: TgContext,
    userId?: string | null
): Promise<LocaleMessages> => {
    // Check if user language config is enabled (default false)
    if (!getBooleanValue(c.env.TG_ALLOW_USER_LANG)) {
        return i18n.getMessages(c.env.DEFAULT_LANG || 'en');
    }

    const uid = userId || ctx?.message?.from?.id?.toString() || ctx?.callbackQuery?.from?.id?.toString();
    if (uid) {
        const savedLang = await c.env.KV.get(`${CONSTANTS.TG_KV_PREFIX}:lang:${uid}`);
        if (savedLang) { return i18n.getMessages(savedLang); }
    }
    return i18n.getMessages(c.env.DEFAULT_LANG || 'en');
};

// Bilingual command descriptions with full usage instructions
const COMMANDS = [
    { command: "start", description: "Get started" },
    { command: "new", description: "Create address, /new <name>@<domain>" },
    { command: "address", description: "View address list" },
    { command: "bind", description: "Bind address, /bind <credential>" },
    { command: "unbind", description: "Unbind address, /unbind <address>" },
    { command: "delete", description: "Delete address, /delete <address>" },
    { command: "mails", description: "View mails, /mails <address>" },
    { command: "cleaninvalidaddress", description: "Clean invalid addresses" },
    { command: "lang", description: "Set language" },
    { command: "fake", description: "Generate Fake ID (e.g. /fake id, /fake us)" }, // <-- FITUR FAKE ID
]

export const getTelegramCommands = (c: Context<HonoCustomType>) => {
    return getBooleanValue(c.env.TG_ALLOW_USER_LANG)
        ? COMMANDS
        : COMMANDS.filter(cmd => cmd.command !== "lang");
}

export function newTelegramBot(c: Context<HonoCustomType>, token: string): Telegraf {
    const bot = new Telegraf(token);
    const botInfo = getJsonObjectValue<UserFromGetMe>(c.env.TG_BOT_INFO);
    if (botInfo) {
        bot.botInfo = botInfo;
    }

    bot.use(async (ctx, next) => {
        // check if in private chat
        if (ctx.chat?.type !== "private") {
            return;
        }

        const userId = ctx?.message?.from?.id || ctx.callbackQuery?.message?.chat?.id;
        if (!userId) {
            const msgs = await getTgMessages(c, ctx);
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }

        const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
        if (settings?.enableAllowList
            && !settings.allowList.includes(userId.toString())
        ) {
            const msgs = await getTgMessages(c, ctx);
            return await ctx.reply(msgs.TgNoPermissionMsg);
        }
        try {
            await next();
        } catch (error) {
            console.error(`Error: ${error}`);
            return await ctx.reply(`Error: ${error}`);
        }
    })

    bot.command("start", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const prefix = getStringValue(c.env.PREFIX)
        const domains = getDomains(c);
        const commands = getTelegramCommands(c);
        return await ctx.reply(
            `${msgs.TgWelcomeMsg}\n\n`
            + (prefix ? `${msgs.TgCurrentPrefixMsg} ${prefix}\n` : '')
            + `${msgs.TgCurrentDomainsMsg} ${JSON.stringify(domains)}\n`
            + `${msgs.TgAvailableCommandsMsg}\n`
            + commands.map(cmd => `/${cmd.command}: ${cmd.description}`).join("\n")
        );
    });

    bot.command("new", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/new".length).trim();
            const res = await tgUserNewAddress(c, userId.toString(), address, msgs);
            return await ctx.reply(`${msgs.TgCreateSuccessMsg}\n`
                + `${msgs.TgAddressMsg} ${res.address}\n`
                + (res.password ? `${msgs.TgPasswordMsg} \`${res.password}\`\n` : '')
                + `${msgs.TgCredentialMsg} \`${res.jwt}\`\n`,
                {
                    parse_mode: "Markdown"
                }
            );
        } catch (e) {
            return await ctx.reply(`${msgs.TgCreateFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("bind", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const jwt = ctx?.message?.text.slice("/bind".length).trim();
            if (!jwt) {
                return await ctx.reply(msgs.TgPleaseInputCredentialMsg);
            }
            const address = await bindTelegramAddress(c, userId.toString(), jwt, msgs);
            return await ctx.reply(`${msgs.TgBindSuccessMsg}\n`
                + `${msgs.TgAddressMsg} ${address}`
            );
        }
        catch (e) {
            return await ctx.reply(`${msgs.TgBindFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("unbind", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/unbind".length).trim();
            if (!address) {
                return await ctx.reply(msgs.TgPleaseInputAddressMsg);
            }
            await unbindTelegramAddress(c, userId.toString(), address);
            return await ctx.reply(`${msgs.TgUnbindSuccessMsg}\n${msgs.TgAddressMsg} ${address}`
            );
        }
        catch (e) {
            return await ctx.reply(`${msgs.TgUnbindFailedMsg} ${(e as Error).message}`);
        }
    })

    bot.command("delete", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/delete".length).trim();
            if (!address) {
                return await ctx.reply(msgs.TgPleaseInputAddressMsg);
            }
            await deleteTelegramAddress(c, userId.toString(), address, msgs);
            return await ctx.reply(`${msgs.TgDeleteSuccessMsg} ${address}`);
        } catch (e) {
            return await ctx.reply(`${msgs.TgDeleteFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("address", async (ctx) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
            const { addressList } = await jwtListToAddressData(c, jwtList, msgs);
            return await ctx.reply(`${msgs.TgAddressListMsg}\n\n`
                + addressList.map(a => `${msgs.TgAddressMsg} ${a}`).join("\n")
            );
        } catch (e) {
            return await ctx.reply(`${msgs.TgGetAddressFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("cleaninvalidaddress", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
            const { invalidJwtList } = await jwtListToAddressData(c, jwtList, msgs);
            const newJwtList = jwtList.filter(jwt => !invalidJwtList.includes(jwt));
            await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, JSON.stringify(newJwtList));
            const { addressList } = await jwtListToAddressData(c, newJwtList, msgs);
            return await ctx.reply(`${msgs.TgCleanSuccessMsg}\n\n`
                + `${msgs.TgCurrentAddressListMsg}\n\n`
                + addressList.map(a => `${msgs.TgAddressMsg} ${a}`).join("\n")
            );
        } catch (e) {
            return await ctx.reply(`${msgs.TgCleanFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("lang", async (ctx: TgContext) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            const msgs = await getTgMessages(c, ctx);
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }

        const msgs = await getTgMessages(c, ctx);

        // Check if user language config is enabled
        if (!getBooleanValue(c.env.TG_ALLOW_USER_LANG)) {
            return await ctx.reply(msgs.TgLangFeatureDisabledMsg);
        }

        // @ts-ignore
        const lang = ctx?.message?.text.slice("/lang".length).trim().toLowerCase();
        if (lang === 'zh' || lang === 'en') {
            await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:lang:${userId}`, lang);
            return await ctx.reply(`${msgs.TgLangSetSuccessMsg} ${lang === 'zh' ? 'Chinese' : 'English'}`);
        }

        const currentLang = await c.env.KV.get(`${CONSTANTS.TG_KV_PREFIX}:lang:${userId}`);
        return await ctx.reply(
            `${msgs.TgCurrentLangMsg} ${currentLang || 'auto'}\n`
            + `${msgs.TgSelectLangMsg}\n`
            + `/lang zh - Chinese\n`
            + `/lang en - English`
        );
    });

    // --- FITUR BARU: GENERATE FAKE IDENTITY (DENGAN LOCALE) ---
    bot.command("fake", async (ctx) => {
        // Daftar negara yang didukung (Asia & Eropa)
        const supportedLocales: Record<string, { faker: Faker, name: string }> = {
            // Default / Amerika
            'us': { faker: fakerEN_US, name: 'United States' },
            'usa': { faker: fakerEN_US, name: 'United States' },

            // --- ASIA ---
            'id': { faker: fakerID_ID, name: 'Indonesia' },
            'jp': { faker: fakerJA, name: 'Japan' },
            'kr': { faker: fakerKO, name: 'South Korea' },
            'cn': { faker: fakerZH_CN, name: 'China' },
            'tw': { faker: fakerZH_TW, name: 'Taiwan' },
            'vn': { faker: fakerVI, name: 'Vietnam' },
            'th': { faker: fakerTH, name: 'Thailand' },
            'in': { faker: fakerEN_IN, name: 'India' },
            'np': { faker: fakerNE, name: 'Nepal' },
            'tr': { faker: fakerTR, name: 'Turkey' },

            // --- EROPA ---
            'uk': { faker: fakerEN_GB, name: 'United Kingdom' },
            'gb': { faker: fakerEN_GB, name: 'United Kingdom' },
            'fr': { faker: fakerFR, name: 'France' },
            'de': { faker: fakerDE, name: 'Germany' },
            'it': { faker: fakerIT, name: 'Italy' },
            'es': { faker: fakerES, name: 'Spain' },
            'ru': { faker: fakerRU, name: 'Russia' },
            'ua': { faker: fakerUK, name: 'Ukraine' },
            'pl': { faker: fakerPL, name: 'Poland' },
            'nl': { faker: fakerNL, name: 'Netherlands' },
            'pt': { faker: fakerPT_PT, name: 'Portugal' },
            'se': { faker: fakerSV, name: 'Sweden' },
            'fi': { faker: fakerFI, name: 'Finland' },
            'cz': { faker: fakerCS_CZ, name: 'Czech Republic' },
        };

        const args = ctx.message.text.split(/\s+/);
        let selectedFaker = fakerEN_US;
        let selectedName = "United States";

        // Logic Validasi:
        if (args[1]) {
            // Jika user memasukkan kode negara (contoh: /fake mars atau /fake id)
            const inputCode = args[1].toLowerCase();
            const selected = supportedLocales[inputCode];

            if (selected) {
                // Jika support
                selectedFaker = selected.faker;
                selectedName = selected.name;
            } else {
                // Jika TIDAK support (contoh: /fake mars)
                return await ctx.reply("Belum support untuk identity ini");
            }
        } 
        // Jika tidak ada argumen (/fake), lanjut menggunakan default US

        // Generate Data
        const sex = selectedFaker.person.sexType();
        const firstName = selectedFaker.person.firstName(sex);
        const lastName = selectedFaker.person.lastName();
        const address = selectedFaker.location.streetAddress(true); 
        const city = selectedFaker.location.city();
        let state = "-";
        try { state = selectedFaker.location.state(); } catch(e) {} // Handle optional state
        const zip = selectedFaker.location.zipCode();
        const phone = selectedFaker.phone.number();
        const lat = selectedFaker.location.latitude();
        const long = selectedFaker.location.longitude();

        const message = 
            `Full Name\t\`${firstName} ${lastName}\`\n` +
            `Gender\t\`${sex}\`\n` +
            `Full Address\t\`${address}\`\n` +
            `City/Town\t\`${city}\`\n` +
            `State/Province/Region\t\`${state}\`\n` +
            `Zip/Postal Code\t\`${zip}\`\n` +
            `Phone Number\t\`${phone}\`\n` +
            `Country\t\`${selectedName}\`\n` + 
            `Latitude\t\`${lat}\`\n` +
            `Longitude\t\`${long}\``;

        return await ctx.reply(message, { parse_mode: "Markdown" });
    });

    const queryMail = async (ctx: TgContext, queryAddress: string, mailIndex: number, edit: boolean) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id || ctx.callbackQuery?.message?.chat?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
        const { addressList, addressIdMap } = await jwtListToAddressData(c, jwtList, msgs);
        if (!queryAddress && addressList.length > 0) {
            queryAddress = addressList[0];
        }
        if (!(queryAddress in addressIdMap)) {
            return await ctx.reply(`${msgs.TgNotBoundAddressMsg} ${queryAddress}`);
        }
        const address_id = addressIdMap[queryAddress];
        const db_address_id = await c.env.DB.prepare(
            `SELECT id FROM address where id = ? `
        ).bind(address_id).first("id");
        if (!db_address_id) {
            return await ctx.reply(msgs.TgInvalidAddressMsg);
        }
        const { raw, id: mailId, created_at } = await c.env.DB.prepare(
            `SELECT * FROM raw_mails where address = ? `
            + ` order by id desc limit 1 offset ?`
        ).bind(
            queryAddress, mailIndex
        ).first<{ raw: string, id: string, created_at: string }>() || {};
        const { mail } = raw ? await parseMail(msgs, { rawEmail: raw }, queryAddress, created_at) : { mail: msgs.TgNoMoreMailsMsg };
        const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
        const miniAppButtons = []
        if (settings?.miniAppUrl && settings?.miniAppUrl?.length > 0 && mailId) {
            const url = new URL(settings.miniAppUrl);
            url.pathname = "/telegram_mail"
            url.searchParams.set("mail_id", mailId);
            miniAppButtons.push(Markup.button.webApp(msgs.TgViewMailBtnMsg, url.toString()));
        }
        if (edit) {
            return await ctx.editMessageText(mail || msgs.TgNoMailMsg,
                {
                    ...Markup.inlineKeyboard([
                        Markup.button.callback(msgs.TgPrevBtnMsg, `mail_${queryAddress}_${mailIndex - 1}`, mailIndex <= 0),
                        ...miniAppButtons,
                        Markup.button.callback(msgs.TgNextBtnMsg, `mail_${queryAddress}_${mailIndex + 1}`, !raw),
                    ])
                },
            );
        }
        return await ctx.reply(mail || msgs.TgNoMailMsg,
            {
                ...Markup.inlineKeyboard([
                    Markup.button.callback(msgs.TgPrevBtnMsg, `mail_${queryAddress}_${mailIndex - 1}`, mailIndex <= 0),
                    ...miniAppButtons,
                    Markup.button.callback(msgs.TgNextBtnMsg, `mail_${queryAddress}_${mailIndex + 1}`, !raw),
                ])
            },
        );
    }

    bot.command("mails", async ctx => {
        const msgs = await getTgMessages(c, ctx);
        try {
            const queryAddress = ctx?.message?.text.slice("/mails".length).trim();
            return await queryMail(ctx, queryAddress, 0, false);
        } catch (e) {
            return await ctx.reply(`${msgs.TgGetMailFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.on(callbackQuery("data"), async ctx => {
        const msgs = await getTgMessages(c, ctx);
        // Use ctx.callbackQuery.data
        try {
            const data = ctx.callbackQuery.data;
            if (data && data.startsWith("mail_") && data.split("_").length === 3) {
                const [_, queryAddress, mailIndex] = data.split("_");
                await queryMail(ctx, queryAddress, parseInt(mailIndex), true);
            }
        }
        catch (e) {
            console.log(`${msgs.TgGetMailFailedMsg} ${(e as Error).message}`, e);
            return await ctx.answerCbQuery(`${msgs.TgGetMailFailedMsg} ${(e as Error).message}`);
        }
        await ctx.answerCbQuery();
    });

    // --- FITUR BARU: 2FA / OTP Generator ---
    // Menangkap pesan teks biasa (yang bukan command)
    bot.on("text", async (ctx) => {
        // Ambil teks pesan
        const text = ctx.message.text.trim().replace(/\s/g, '').toUpperCase();

        // Regex untuk validasi Base32 (Huruf A-Z dan Angka 2-7)
        // Panjang minimal 10 karakter untuk menghindari trigger dari chat biasa
        const base32Regex = /^[A-Z2-7]{10,}$/;

        if (base32Regex.test(text)) {
            try {
                // Konfigurasi TOTP
                const totp = new OTPAuth.TOTP({
                    issuer: "TelegramBot",
                    label: "User",
                    algorithm: "SHA1",
                    digits: 6,
                    period: 30,
                    secret: OTPAuth.Secret.fromBase32(text)
                });

                // Generate kode
                const code = totp.generate();

                // Balas dengan format yang diminta
                return await ctx.reply(`Your OTP code is: \`${code}\``, {
                    parse_mode: "Markdown"
                });
            } catch (e) {
                // Abaikan error jika format salah agar tidak spam
                console.error("OTP Error", e);
            }
        }
    });

    return bot;
}


export async function initTelegramBotCommands(c: Context<HonoCustomType>, bot: Telegraf) {
    await bot.telegram.setMyCommands(getTelegramCommands(c));
}

const parseMail = async (
    msgs: LocaleMessages,
    parsedEmailContext: ParsedEmailContext,
    address: string, created_at: string | undefined | null
) => {
    if (!parsedEmailContext.rawEmail) {
        return {};
    }
    try {
        const parsedEmail = await commonParseMail(parsedEmailContext);
        let parsedText = parsedEmail?.text || "";
        if (parsedText.length && parsedText.length > 1000) {
            parsedText = parsedEmail?.text.substring(0, 1000) + `\n\n...\n${msgs.TgMsgTooLongMsg}`;
        }
        return {
            isHtml: false,
            mail: `From: ${parsedEmail?.sender || msgs.TgNoSenderMsg}\n`
                + `To: ${address}\n`
                + (created_at ? `Date: ${created_at}\n` : "")
                + `Subject: ${parsedEmail?.subject}\n`
                + `Content:\n${parsedText || msgs.TgParseFailedViewInAppMsg}`
        };
    } catch (e) {
        return {
            isHtml: false,
            mail: `${msgs.TgParseMailFailedMsg} ${(e as Error).message}`
        };
    }
}


export async function sendMailToTelegram(
    c: Context<HonoCustomType>, address: string,
    parsedEmailContext: ParsedEmailContext,
    message_id: string | null
) {
    if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.KV) {
        return;
    }
    const userId = await c.env.KV.get(`${CONSTANTS.TG_KV_PREFIX}:${address}`);
    const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
    const globalPush = settings?.enableGlobalMailPush && settings?.globalMailPushList;
    if (!userId && !globalPush) {
        return;
    }
    const mailId = await c.env.DB.prepare(
        `SELECT id FROM raw_mails where address = ? and message_id = ?`
    ).bind(address, message_id).first<string>("id");
    const bot = newTelegramBot(c, c.env.TELEGRAM_BOT_TOKEN);

    const buildAndSend = async (targetUserId: string, msgs: LocaleMessages) => {
        const { mail } = await parseMail(msgs, parsedEmailContext, address, new Date().toUTCString());
        if (!mail) return;
        const buttons = [];
        if (settings?.miniAppUrl && mailId) {
            const url = new URL(settings.miniAppUrl);
            url.pathname = "/telegram_mail"
            url.searchParams.set("mail_id", mailId);
            buttons.push(Markup.button.webApp(msgs.TgViewMailBtnMsg, url.toString()));
        }
        await bot.telegram.sendMessage(targetUserId, mail, {
            ...Markup.inlineKeyboard([...buttons])
        });
    };

    if (globalPush) {
        const globalMsgs = i18n.getMessages(c.env.DEFAULT_LANG || 'en');
        for (const pushId of settings.globalMailPushList) {
            await buildAndSend(pushId, globalMsgs);
        }
    }

    if (userId) {
        const userMsgs = await getTgMessages(c, undefined, userId);
        await buildAndSend(userId, userMsgs);
    }
}