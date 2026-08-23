import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class QueritApi implements ICredentialType {
	name = 'queritApi';

	displayName = 'Querit API';

	icon = {
		light: 'file:../nodes/Querit/querit.svg',
		dark: 'file:../nodes/Querit/querit.dark.svg',
	} as const;

	documentationUrl =
		'https://github.com/querit-ai/querit-plugins/tree/main/n8n-nodes-querit#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.querit.ai',
			url: '/v1/search',
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: {
				query: 'n8n credential test',
				count: 1,
			},
			json: true,
			allowedDomains: 'api.querit.ai',
			sendCredentialsOnCrossOriginRedirect: false,
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'error_code',
					value: 401,
					message: 'The Querit API did not accept this API key',
				},
			},
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'error_code',
					value: '401',
					message: 'The Querit API did not accept this API key',
				},
			},
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'error_code',
					value: 403,
					message: 'The Querit API did not accept this API key',
				},
			},
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'error_code',
					value: '403',
					message: 'The Querit API did not accept this API key',
				},
			},
		],
	};

	supportedNodes = ['n8n-nodes-querit.querit'];

	restrictToSupportedNodes = true as const;
}
