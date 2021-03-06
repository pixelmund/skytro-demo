import { authenticateUser, hashPassword, verifyPassword } from '$lib/auth';
import { db } from '$lib/db';
import { builder } from '$graphql/builder';
import { Result } from './ResultResolver';

builder.queryField('me', (t) =>
	t.prismaField({
		type: 'User',
		nullable: true,
		// The "me" field can be queried even if you're not logged in:
		skipTypeScopes: true,
		resolve: (query, _root, _args, { userId }) => {
			if (!userId) {
				return null;
			}

			return db.user.findUnique({
				...query,
				where: { id: userId },
				rejectOnNotFound: true
			});
		}
	})
);

builder.mutationField('logout', (t) =>
	t.field({
		type: Result,
		resolve: async (_root, _args, { locals }) => {
			await locals.session.destroy();
			return Result.SUCCESS;
		}
	})
);

const LoginInput = builder.inputType('LoginInput', {
	fields: (t) => ({
		email: t.string({ validate: { email: true } }),
		password: t.string({ validate: { minLength: 6 } })
	})
});

builder.mutationField('login', (t) =>
	t.prismaField({
		type: 'User',
		// The parent auth scope (for the Mutation type) is for authenticated users,
		// so we will need to skip it.
		skipTypeScopes: true,
		authScopes: {
			unauthenticated: true
		},
		args: {
			input: t.arg({ type: LoginInput })
		},
		resolve: async (_query, _root, { input }, { locals }) => {
			const user = await authenticateUser(input.email, input.password);
			await locals.session.data({ userId: user.id });

			return user;
		}
	})
);

const SignUpInput = builder.inputType('SignUpInput', {
	fields: (t) => ({
		name: t.string({
			validate: {
				minLength: 1,
				maxLength: 100
			}
		}),
		email: t.string({ validate: { email: true } }),
		password: t.string({ validate: { minLength: 6 } })
	})
});

builder.mutationField('signUp', (t) =>
	t.prismaField({
		type: 'User',
		// The parent auth scope (for the Mutation type) is for authenticated users,
		// so we will need to skip it.
		skipTypeScopes: true,
		authScopes: {
			unauthenticated: true
		},
		args: {
			input: t.arg({ type: SignUpInput })
		},
		resolve: async (query, _root, { input }, { locals }) => {
			const user = await db.user.create({
				...query,
				data: {
					name: input.name,
					email: input.email,
					hashedPassword: await hashPassword(input.password)
				}
			});

			await locals.session.data({ userId: user.id });

			return user;
		}
	})
);

const ChangePasswordInput = builder.inputType('ChangePasswordInput', {
	fields: (t) => ({
		currentPassword: t.string({
			validate: { minLength: 6 }
		}),
		newPassword: t.string({
			validate: { minLength: 6 }
		})
	})
});

builder.mutationField('changePassword', (t) =>
	t.field({
		type: Result,
		args: {
			input: t.arg({ type: ChangePasswordInput })
		},
		resolve: async (_root, { input }, { userId }) => {
			const user = await db.user.findUnique({ where: { id: userId }, rejectOnNotFound: true });

			// First, we make sure that your current password is currect:
			const passwordValid = await verifyPassword(user.hashedPassword, input.currentPassword);

			if (!passwordValid) {
				throw new Error('Current password was not correct.');
			}

			await db.user.update({
				where: { id: user.id },
				data: {
					hashedPassword: await hashPassword(input.newPassword)
				}
			});

			return Result.SUCCESS;
		}
	})
);
