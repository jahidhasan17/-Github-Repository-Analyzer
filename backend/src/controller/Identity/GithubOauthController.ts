import axios from 'axios';
import { Provider } from '../../const/User';
import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '../../models/interfaces/TokenPayload';
import { User } from '../../models/interfaces/User';
import { UserToken } from '../../models/interfaces/UserToken';
import { UserModel } from '../../models/UserModel';
import { UserTokenModel } from '../../models/UserTokenModel';
import qs from "qs";
import { getUserClaimsFromGithubUser } from '../../services/githubOauth';
import { generateAccessToken, generateRefreshToken } from '../../services/JwtTokenService';
import { addMinutes } from "date-fns";
import { encrypt } from '../../services/EncryptDecrypt';
import createHttpError from 'http-errors';


async function githubOauthLogin(req: Request, res: Response, next: NextFunction) {

	console.log("/github/callback");

	const requestToken = req.query.code;
	const redirectUrl = req.query.state as string;

	console.log(requestToken, redirectUrl);


	try {
		const response = await axios.post(`https://github.com/login/oauth/access_token?client_id=${process.env.GITHUB_OAUTH2_CLIENT_ID}&client_secret=${process.env.GITHUB_OAUTH2_CLIENT_SECRET}&code=${requestToken}`, {
			headers: {
				accept: 'application/x-www-form-urlencoded'
			}
		});


		let accessToken = qs.parse(response.data).access_token;

		console.log("accessToken");
		console.log(accessToken);
		
		res.redirect(`/api/identity/github/success?token=${accessToken}&redirectUrl=${redirectUrl}`)
	}catch(e) {
		console.log("Error occured When Get Github AccessToken");
		console.log(e);
		res.redirect(redirectUrl);
	}
}


async function githubOauthLoginSuccess(req: Request, res: Response, next: NextFunction) {

	console.log("/github/success");

	const accessToken: string = req.query.token as string;
	const redirectUrl = req.query.redirectUrl as string;

	console.log(accessToken, redirectUrl);

	let response;
	try{
		response = await axios.get(`https://api.github.com/user`, {
			headers: {
				Authorization: 'token ' + accessToken
			}
		});
	}catch(error) {
		console.log("Error Occured When User info Get from Github");
		console.log(error);
		res.redirect(redirectUrl);
		return;
	}

	let currentUserData = response?.data;
	console.log("currentUserData");
	console.log(currentUserData);


	const userClaims: TokenPayload = getUserClaimsFromGithubUser(currentUserData);
	console.log("userClaims", userClaims);


	try {

		let user = await UserModel.findOne<User>({
			UserName: userClaims.UserName,
			Provider: Provider.GITHUB
		})

		console.log("user", user);
	
		if(!user) {
			user = await new UserModel<User>({...userClaims} as User).save();

			console.log("New User", user);
		}


		const AccessToken = generateAccessToken(userClaims);

		const RefreshToken = generateRefreshToken();

		console.log("AccessToken", "RefreshToken");
		console.log(AccessToken, RefreshToken);

		const refreshTokenExpiryTime = process.env.REFRESH_TOKEN_EXPIRY_TIME as unknown;
		console.log("refreshTokenExpiryTime",refreshTokenExpiryTime);

		await UserTokenModel.updateOne<UserToken>(
			{UserId : user._id},
			{$set : {
				RefreshToken: RefreshToken,
				GithubAccessToken: encrypt(accessToken),
				RefreshTokenExpiryTime: addMinutes(Date.now(), refreshTokenExpiryTime as number)
			}},
			{upsert: true}
		);


		res.cookie('AccessToken', AccessToken);
		res.cookie('RefreshToken', RefreshToken);

		res.redirect(redirectUrl);
		
	}catch(error) {
		console.log(error);
		res.redirect(redirectUrl);
		return;
	}
}



export {
	githubOauthLogin,
	githubOauthLoginSuccess
}